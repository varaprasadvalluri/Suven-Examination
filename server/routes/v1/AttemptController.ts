import express from 'express';
import { requireSession } from '../../auth/middleware';
import { authorizeWrite, scopeFieldFor, scopeValueFor, ProxyRole } from '../../authorization';
import { checkDuplicateSubmission } from '../../middleware/duplicateSubmission';
import { asyncHandler } from '../../middleware/errorHandler';
import { attemptDao, invitationDao, studentDao, examDao } from '../../dao';
import { recomputeAttemptScore } from '../../lib/scoreVerification';
import { normalizePageParams } from '../../dao/pagination';
import { BadRequestError } from '../../lib/errors';
import { randomUUID } from 'node:crypto';

const router = express.Router();

const SORTABLE_FIELDS = new Set(['startTime', 'score', 'endTime']);

// v1 counterpart of server/routes/attempts.ts, calling AttemptDao instead of firestoreClient/
// enqueueWrite directly. Same tenant scoping, same dup-submission lock. Additive only.
/**
 * @openapi
 * /api/v1/attempts:
 *   get:
 *     summary: List attempts with fixed, documented filters
 *     description: >
 *       Requires a valid session. Replaces the generic /api/db/query proxy for attempts.
 *       A 'school' caller's schoolId and a 'student' caller's studentId are always forced
 *       from the session, never trusted from the query string. total in the response
 *       replaces getCountFromServer — no separate count round-trip needed.
 *     tags: [Attempts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: examId
 *         schema: { type: string }
 *       - in: query
 *         name: schoolId
 *         schema: { type: string }
 *       - in: query
 *         name: studentId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [startTime, score, endTime] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: "{ items, page, pageSize, total, totalPages }"
 *       401:
 *         description: Missing or invalid session
 */
router.get(
  '/api/v1/attempts',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const { page, pageSize } = normalizePageParams(req.query);
    const sortByRaw = typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined;
    const sortBy = sortByRaw && SORTABLE_FIELDS.has(sortByRaw) ? (sortByRaw as 'startTime' | 'score' | 'endTime') : undefined;

    let schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : undefined;
    let studentId = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
    if (req.auth.role === 'school') {
      schoolId = req.auth.schoolId;
    } else if (req.auth.role === 'student') {
      studentId = req.auth.uid;
    }

    const result = await attemptDao.findByFilters({
      examId: typeof req.query.examId === 'string' ? req.query.examId : undefined,
      schoolId,
      studentId,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      sortBy,
      page,
      pageSize
    });

    return res.status(200).json({ success: true, data: result });
  })
);

/**
 * @openapi
 * /api/v1/attempts/{attemptId}:
 *   get:
 *     summary: Get a single attempt by ID
 *     description: >
 *       Requires a valid session. Non-admin callers are tenant-scoped: if the attempt's
 *       scope field (per scopeFieldFor/scopeValueFor for the caller's role) doesn't match
 *       the caller, a synthetic { exists: false } result is returned instead of a 403 —
 *       so this endpoint doesn't reveal whether an attempt ID exists to a caller who
 *       shouldn't see it.
 *     tags: [Attempts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "Attempt document, or an { id, exists: false } shape if not found / not visible to this caller"
 *       401:
 *         description: Missing or invalid session
 */
router.get(
  '/api/v1/attempts/:attemptId',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const { attemptId } = req.params;
    const attemptResult = await attemptDao.findById(attemptId);
    if (!attemptResult.exists) {
      return res.status(200).json({ success: true, data: attemptResult });
    }
    const docData = attemptResult.data as any;

    if (req.auth.role !== 'admin') {
      const scopeField = scopeFieldFor('attempts', req.auth.role as ProxyRole);
      const scopeValue = scopeValueFor(req.auth, req.auth.role as ProxyRole);
      if (scopeField && docData[scopeField] !== scopeValue) {
        return res.status(200).json({ success: true, data: { id: attemptId, exists: false } });
      }
    }

    return res.status(200).json({ success: true, data: attemptResult });
  })
);

/**
 * @openapi
 * /api/v1/attempts/{attemptId}/submit:
 *   post:
 *     summary: Submit (complete) an exam attempt
 *     description: >
 *       Requires a valid session. Score/accuracy in the request body are ignored — the
 *       server recomputes them from the real answer key (recomputeAttemptScore) before the
 *       write is authorized, so a client can never submit a forged score. Guarded against
 *       duplicate submission by checkDuplicateSubmission.
 *     tags: [Attempts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               answers:
 *                 type: array
 *                 items: { type: object }
 *                 description: The student's submitted answers. score/accuracy fields, if present, are discarded and recomputed server-side.
 *     responses:
 *       200:
 *         description: Submission result
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: authorizeWrite denied the submission
 *       409:
 *         description: Duplicate submission detected
 */
router.post(
  '/api/v1/attempts/:attemptId/submit',
  requireSession,
  (req: any, _res, next) => {
    req.body = {
      type: 'update',
      collectionName: 'attempts',
      docId: req.params.attemptId,
      data: { ...req.body, status: 'completed' }
    };
    next();
  },
  checkDuplicateSubmission,
  asyncHandler(async (req: any, res) => {
    const { docId, data } = req.body;
    // Never trust a client-submitted score/accuracy — recompute from the real answer key
    // before this write is authorized or queued. See server/lib/scoreVerification.ts.
    const verified = await recomputeAttemptScore(docId, data.answers || []);
    data.score = verified.score;
    data.accuracy = verified.accuracy;

    const decision = await authorizeWrite(req.auth, 'update', 'attempts', docId, data);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const submitResult = await attemptDao.submit(docId, decision.data);
    return res.status(200).json(submitResult);
  })
);

/**
 * @openapi
 * /api/v1/attempts/{attemptId}:
 *   patch:
 *     summary: Update an attempt (autosave, violation counts, canReattempt, proctoring flags)
 *     description: >
 *       Requires a valid session. Rejects status:'completed' — that must go through
 *       POST /api/v1/attempts/{attemptId}/submit, which recomputes the score server-side
 *       and is guarded by checkDuplicateSubmission. Same authorizeWrite tenant-scoping as
 *       every other attempts write.
 *     tags: [Attempts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: attemptId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Update result
 *       400:
 *         description: Attempted to set status:'completed' via this route
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: authorizeWrite denied the update
 */
router.patch(
  '/api/v1/attempts/:attemptId',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const { attemptId } = req.params;
    if (req.body && req.body.status === 'completed') {
      throw new BadRequestError("Use POST /api/v1/attempts/:attemptId/submit to complete an attempt, not PATCH.");
    }

    const decision = await authorizeWrite(req.auth, 'update', 'attempts', attemptId, req.body);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const updateResult = await attemptDao.update(attemptId, decision.data);
    return res.status(200).json(updateResult);
  })
);

/**
 * @openapi
 * /api/v1/schools/{schoolId}/exams/{examId}/attempts/trigger:
 *   post:
 *     summary: Trigger/re-trigger exam access links for a set of students
 *     description: >
 *       Admin or school role. A school caller may only act on their own school. Replaces
 *       SchoolStudentOnboarding.tsx's client-built writeBatch skip/re-enable/new-invite
 *       decision tree (non-atomic, sequential /api/db/write calls with client-computed
 *       decisions) with one server-side decision per student, run via Promise.allSettled.
 *       Touches both attempts (canReattempt) and invitations.
 *     tags: [Attempts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: examId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               studentIds:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: "{ triggered, reTriggered, skipped, failed }"
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not admin/school, or a school caller doesn't own this school
 */
router.post(
  '/api/v1/schools/:schoolId/exams/:examId/attempts/trigger',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const { schoolId, examId } = req.params;
    const studentIds: string[] = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];

    if (req.auth.role !== 'admin' && req.auth.role !== 'school') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (req.auth.role === 'school' && req.auth.schoolId !== schoolId) {
      return res.status(403).json({ error: "Forbidden: you may only trigger links for your own school" });
    }
    if (studentIds.length === 0) {
      throw new BadRequestError('studentIds must be a non-empty array.');
    }

    const examResult = await examDao.findById(examId);
    if (!examResult.exists) {
      throw new BadRequestError('Exam not found.');
    }
    const examTitle = (examResult.data as any)?.title || '';

    const [schoolStudents, existingAttempts, existingInvitations] = await Promise.all([
      studentDao.findBySchool(schoolId),
      attemptDao.findByFilters({ examId, schoolId, page: 1, pageSize: 1000 }),
      invitationDao.findByExam(schoolId, examId)
    ]);

    const studentById = new Map<string, any>();
    for (const record of schoolStudents) {
      studentById.set(record.id, record.data as any);
    }
    const attemptByStudent = new Map<string, any>();
    for (const record of existingAttempts.items) {
      const data = record.data as any;
      if (data?.studentId) attemptByStudent.set(data.studentId, { id: record.id, ...data });
    }
    const inviteByStudent = new Map<string, any>();
    for (const record of existingInvitations) {
      const data = record.data as any;
      if (data?.studentId) inviteByStudent.set(data.studentId, { id: record.id, ...data });
    }

    let triggered = 0;
    let reTriggered = 0;
    let skipped = 0;
    let failed = 0;

    // Mirrors SchoolStudentOnboarding.tsx's original client-side handleBulkTrigger decision
    // tree exactly, just run server-side per student instead of via a non-atomic writeBatch.
    const outcomes = await Promise.allSettled(
      studentIds.map(async (studentId) => {
        const student = studentById.get(studentId);
        if (!student) throw new Error('Student not found in this school.');

        const attempt = attemptByStudent.get(studentId);
        const existingInvite = inviteByStudent.get(studentId);

        if (attempt?.status === 'started' || attempt?.status === 'in-progress' || (attempt?.status === 'completed' && attempt.canReattempt)) {
          skipped++;
          return;
        }

        if (attempt?.status === 'completed' && !attempt.canReattempt) {
          const attemptDecision = await authorizeWrite(req.auth, 'update', 'attempts', attempt.id, { canReattempt: true });
          if (attemptDecision.ok === false) throw new Error(attemptDecision.error);
          await attemptDao.update(attempt.id, attemptDecision.data);

          if (existingInvite) {
            await invitationDao.setStatus(existingInvite.id, 'sent');
          } else {
            const token = randomUUID();
            const payload = {
              id: token,
              studentId,
              studentName: student.name,
              studentEmail: student.email || '',
              examId,
              examTitle,
              schoolId,
              status: 'sent',
              createdAt: new Date().toISOString()
            };
            const inviteDecision = await authorizeWrite(req.auth, 'add', 'invitations', undefined, payload);
            if (inviteDecision.ok === false) throw new Error(inviteDecision.error);
            await invitationDao.create(token, inviteDecision.data);
          }
          reTriggered++;
          return;
        }

        if (existingInvite) {
          skipped++;
          return;
        }

        const token = randomUUID();
        const payload = {
          id: token,
          studentId,
          studentName: student.name,
          studentEmail: student.email || '',
          examId,
          examTitle,
          schoolId,
          status: 'sent',
          createdAt: new Date().toISOString()
        };
        const inviteDecision = await authorizeWrite(req.auth, 'add', 'invitations', undefined, payload);
        if (inviteDecision.ok === false) throw new Error(inviteDecision.error);
        await invitationDao.create(token, inviteDecision.data);
        triggered++;
      })
    );

    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') failed++;
    }

    return res.status(200).json({ success: failed === 0, triggered, reTriggered, skipped, failed });
  })
);

export default router;
