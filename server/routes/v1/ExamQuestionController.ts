import express from 'express';
import { resolveAuth, RequestAuth } from '../../auth/middleware';
import { sanitizeForPublicRead } from '../../authorization';
import { questionDao, attemptDao } from '../../dao';
import { queryCache, CACHE_TTLS } from '../../db/cache';
import { asyncHandler } from '../../middleware/errorHandler';

const router = express.Router();

// Faithful copy of the answer-key sanitization gate (also duplicated in
// server/routes/examQuestions.ts and server/routes/db.ts) — gated on attempt status ===
// 'completed', never doc existence. This is security-critical (previously-fixed leak); kept
// identical rather than refactored into a shared helper so each route's behavior is
// independently readable and reviewable, matching the existing pattern in this codebase.
async function shouldSanitizeQuestions(examId: string, caller: RequestAuth | null): Promise<boolean> {
  if (!caller) return true;
  if (caller.role !== 'student') return false;
  const attemptResult = await attemptDao.findById(`att_${examId}_${caller.uid}`);
  if (!attemptResult.exists) return true;
  const status = (attemptResult.data as any)?.status;
  return status !== 'completed';
}

// v1 counterpart of server/routes/examQuestions.ts, calling QuestionDao/AttemptDao instead
// of firestoreClient directly. Additive only.
/**
 * @openapi
 * /api/v1/exams/{examId}/questions:
 *   get:
 *     summary: List questions for an exam
 *     description: >
 *       Authentication is optional (bearer token read if present via resolveAuth, but not
 *       required). Answer-key fields are sanitized out of the response (via
 *       sanitizeForPublicRead) unless the caller is an authenticated student whose own
 *       attempt for this exam is already status='completed' — i.e. only after they've
 *       finished, so answers are never exposed before/during an active attempt.
 *     tags: [Exam Questions]
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: examId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of questions (answer key sanitized unless the caller has a completed attempt)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 */
router.get(
  '/api/v1/exams/:examId/questions',
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    const caller = await resolveAuth(req);
    const shouldSanitize = await shouldSanitizeQuestions(examId, caller);

    const cacheKey = JSON.stringify({
      collectionName: 'questions',
      constraints: [{ type: 'where', field: 'examId', op: '==', value: examId }]
    });
    const ttl = CACHE_TTLS['questions'] || 0;
    const cached = queryCache.get(cacheKey);

    let docList: { id: string; data: any }[];
    if (ttl > 0 && cached && Date.now() - cached.timestamp < ttl) {
      docList = cached.data;
    } else {
      docList = await questionDao.findByExamId(examId);
      if (ttl > 0) {
        queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
      }
    }

    const payload = shouldSanitize ? docList.map((item) => ({ ...item, data: sanitizeForPublicRead('questions', item.data) })) : docList;

    return res.status(200).json({ success: true, data: payload });
  })
);

export default router;
