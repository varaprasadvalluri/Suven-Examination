import express from 'express';
import { requireSession, requireRole } from '../../auth/middleware';
import { authorizeWrite } from '../../authorization';
import { studentDao } from '../../dao';
import { asyncHandler } from '../../middleware/errorHandler';
import {
  clientDb,
  clientCollection,
  clientDoc,
  clientQuery,
  clientWhere,
  clientLimit,
  clientGetDoc,
  clientGetDocs
} from '../../firestoreClient';
import { enqueueWrite } from '../../db/writeQueue';
import { logger } from '../../lib/logger';
import { NotFoundError, ForbiddenError } from '../../lib/errors';

const router = express.Router();

// v1 counterpart of server/routes/students.ts, calling StudentDao instead of firestoreClient/
// enqueueWrite directly. Same tenant-scoping and authorizeWrite checks, byte-for-byte —
// additive only, the unversioned routes are untouched.
/**
 * @openapi
 * /api/v1/schools/{schoolId}/students:
 *   get:
 *     summary: List students belonging to a school
 *     description: Admin or school role only. A 'school' caller may only list their own school's students (enforced by matching req.auth.schoolId).
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of student documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Not admin/school, or a school caller requesting a different school's students
 */
router.get(
  '/api/v1/schools/:schoolId/students',
  requireSession,
  requireRole('admin', 'school'),
  asyncHandler(async (req: any, res) => {
    const { schoolId } = req.params;
    if (req.auth.role === 'school' && req.auth.schoolId !== schoolId) {
      return res.status(403).json({ error: "Forbidden: you may only list your own school's students" });
    }

    const docList = await studentDao.findBySchool(schoolId);
    return res.status(200).json({ success: true, data: docList });
  })
);

/**
 * @openapi
 * /api/v1/schools/{schoolId}/students:
 *   post:
 *     summary: Create (onboard) a student under a school
 *     description: Admin or school role only. Server sets schoolId (from the path) and role='student' on the payload, then runs it through authorizeWrite before creating.
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Student fields (name, rollNumber, dob, etc). schoolId and role are set server-side and cannot be overridden by the caller.
 *     responses:
 *       200:
 *         description: Created student result
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: authorizeWrite denied the write, or caller lacks admin/school role
 */
router.post(
  '/api/v1/schools/:schoolId/students',
  requireSession,
  requireRole('admin', 'school'),
  asyncHandler(async (req: any, res) => {
    const { schoolId } = req.params;
    const payload = { ...req.body, schoolId, role: 'student' };

    const decision = await authorizeWrite(req.auth, 'add', 'users', undefined, payload);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const createResult = await studentDao.create(decision.data);
    return res.status(200).json(createResult);
  })
);

/**
 * @openapi
 * /api/v1/students/{studentId}:
 *   patch:
 *     summary: Update a student record
 *     description: Requires a valid session; field-level authorization is enforced by authorizeWrite (e.g. a student can generally only update their own limited fields, while admin/school have broader access).
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Partial student fields to update. Exact allowed fields are enforced by authorizeWrite, not this route.
 *     responses:
 *       200:
 *         description: Update result
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: authorizeWrite denied the update
 */
router.patch(
  '/api/v1/students/:studentId',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const { studentId } = req.params;

    const decision = await authorizeWrite(req.auth, 'update', 'users', studentId, req.body);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const updateResult = await studentDao.update(studentId, decision.data);
    return res.status(200).json(updateResult);
  })
);

// Cascade-deletes a student and their attempts/error_books/invitations/proctoring_logs.
// Replaces the previous client-side implementation (SchoolStudentOnboarding.tsx used
// Firestore's `writeBatch` API, but this app's writeBatch (src/lib/apiService.ts) is a
// client-side mock — commit() awaits one /api/db/write HTTP call per queued op in a
// sequential loop, no real atomicity). If ANY single one of the (potentially many) queued
// deletes failed for any reason, the whole commit() threw and surfaced a single generic
// "Discrepancy executing folder delete block" toast with no indication of what actually
// failed or what state the data was left in — the exact bug this route fixes, mirroring
// the same fix already applied to school hard-delete (see SchoolController.ts). Uses the
// real write-cushion (server/db/writeQueue.ts) and reports exact per-collection outcomes.
const STUDENT_DEPENDENT_COLLECTIONS = ['attempts', 'error_books', 'invitations', 'proctoring_logs'] as const;
const DELETE_PAGE_SIZE = 500;

/**
 * @openapi
 * /api/v1/students/{studentId}/cascade-delete:
 *   delete:
 *     summary: Permanently delete a student and all their attempts/error_books/invitations/proctoring_logs
 *     description: >
 *       Admin or school role. A school caller may only delete a student belonging to their
 *       own school. Real Firestore batched deletes via the write-cushion, not a client-side
 *       mock — reports exact per-collection success/failure. The student's own user doc is
 *       only deleted once every dependent collection is fully cleared; a partial failure
 *       leaves the student doc in place instead of orphaning leftover data with no owner.
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Per-collection deletion counts, whether the student doc itself was removed
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not admin/school, or a school caller doesn't own this student
 *       404:
 *         description: Student not found
 */
router.delete(
  '/api/v1/students/:studentId/cascade-delete',
  requireSession,
  requireRole('admin', 'school'),
  asyncHandler(async (req: any, res) => {
    const { studentId } = req.params;

    const studentSnap = await clientGetDoc(clientDoc(clientDb, 'users', studentId));
    if (!studentSnap.exists()) {
      throw new NotFoundError('Student not found.');
    }
    const studentData = studentSnap.data() as any;
    if (req.auth.role === 'school' && studentData.schoolId !== req.auth.schoolId) {
      throw new ForbiddenError('Forbidden: you may only delete your own students');
    }

    const results: Record<string, { deleted: number; failed: number }> = {};

    for (const collectionName of STUDENT_DEPENDENT_COLLECTIONS) {
      let deleted = 0;
      let failed = 0;

      while (true) {
        const snap = await clientGetDocs(
          clientQuery(clientCollection(clientDb, collectionName), clientWhere('studentId', '==', studentId), clientLimit(DELETE_PAGE_SIZE))
        );
        if (snap.docs.length === 0) break;

        const settled = await Promise.allSettled(snap.docs.map((d: any) => enqueueWrite({ type: 'delete', collectionName, docId: d.id })));
        for (const outcome of settled) {
          if (outcome.status === 'fulfilled') deleted++;
          else failed++;
        }

        if (failed > 0) break;
        if (snap.docs.length < DELETE_PAGE_SIZE) break;
      }

      results[collectionName] = { deleted, failed };
    }

    const anyFailures = Object.values(results).some((r) => r.failed > 0);
    let studentDeleted = false;
    if (!anyFailures) {
      try {
        await enqueueWrite({ type: 'delete', collectionName: 'users', docId: studentId });
        studentDeleted = true;
      } catch (err) {
        logger.error('Failed to delete student user doc after dependent-collection cascade succeeded', { studentId, error: err });
      }
    }

    logger.info('Student cascade-delete completed', { studentId, schoolId: studentData.schoolId, results, studentDeleted });

    res.status(200).json({ success: !anyFailures && studentDeleted, studentDeleted, results });
  })
);

export default router;
