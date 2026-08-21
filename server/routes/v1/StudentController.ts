import express from 'express';
import { requireSession, requireRole } from '../../auth/middleware';
import { authorizeWrite } from '../../authorization';
import { studentDao } from '../../dao';
import { asyncHandler } from '../../middleware/errorHandler';

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

export default router;
