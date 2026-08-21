import express from 'express';
import { requireSession } from '../../auth/middleware';
import { authorizeWrite, scopeFieldFor, scopeValueFor, ProxyRole } from '../../authorization';
import { checkDuplicateSubmission } from '../../middleware/duplicateSubmission';
import { asyncHandler } from '../../middleware/errorHandler';
import { attemptDao } from '../../dao';
import { recomputeAttemptScore } from '../../lib/scoreVerification';

const router = express.Router();

// v1 counterpart of server/routes/attempts.ts, calling AttemptDao instead of firestoreClient/
// enqueueWrite directly. Same tenant scoping, same dup-submission lock. Additive only.
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

export default router;
