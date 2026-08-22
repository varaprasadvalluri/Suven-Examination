import express from 'express';
import { verifyCloudTasksAuth } from '../middleware/verifyCloudTasksAuth';
import { taskQueueService, GradingTaskDto } from '../lib/taskQueue';
import { enqueueWrite } from '../db/writeQueue';
import { logger } from '../lib/logger';
import { asyncHandler } from '../middleware/errorHandler';
import { BadRequestError, InternalServerError } from '../lib/errors';

const router = express.Router();

// Once a task has been retried this many times, stop trying and mark the attempt as failed
// instead of leaving it stuck at status='submitted' forever — a human then needs to look at
// it, but the student isn't left staring at a "grading..." screen indefinitely.
const MAX_RETRY_BEFORE_GIVING_UP = 5;

/**
 * @openapi
 * /api/internal/grade-attempt:
 *   post:
 *     summary: Worker route for async exam grading, invoked by Cloud Tasks only
 *     description: >
 *       Not a student-facing route — gated by verifyCloudTasksAuth (a Google-signed OIDC
 *       token issued by Cloud Tasks), not requireSession. Grades the attempt via the
 *       existing recomputeAttemptScore and writes status='completed' through the existing
 *       write-batcher (enqueueWrite) — both reused unchanged from the synchronous submit
 *       path. Returns 500 on failure so Cloud Tasks retries per the queue's retry policy;
 *       once the retry count exceeds a small threshold, marks the attempt
 *       status='grading_failed' instead of leaving it stuck at 'submitted' forever.
 *     tags: [Internal]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [attemptId, examId, studentId, answers]
 *             properties:
 *               eventId: { type: string }
 *               timestamp: { type: string }
 *               examId: { type: string }
 *               studentId: { type: string }
 *               attemptId: { type: string }
 *               answers: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Attempt graded and marked completed (or gaveUp=true after exhausting retries)
 *       400:
 *         description: Missing attemptId, examId, studentId, or answers
 *       401:
 *         description: Missing/invalid OIDC token
 *       403:
 *         description: OIDC token not issued to the expected service account
 *       500:
 *         description: Grading failed — Cloud Tasks will retry
 *       503:
 *         description: Cloud Tasks not configured on this deployment
 */
router.post(
  '/api/internal/grade-attempt',
  verifyCloudTasksAuth,
  asyncHandler(async (req: any, res) => {
    const dto = req.body as GradingTaskDto;
    if (!dto?.attemptId || !dto?.examId || !dto?.studentId || !Array.isArray(dto.answers)) {
      throw new BadRequestError('Missing attemptId, examId, studentId, or answers');
    }

    try {
      await taskQueueService.gradeAttempt(dto);
      return res.status(200).json({ success: true, attemptId: dto.attemptId });
    } catch (err: any) {
      logger.error('Grade attempt worker failed', { attemptId: dto.attemptId, examId: dto.examId, error: err });

      const retryCount = parseInt(req.headers['x-cloudtasks-taskretrycount'] || '0', 10);
      if (retryCount >= MAX_RETRY_BEFORE_GIVING_UP) {
        try {
          await enqueueWrite({
            type: 'update',
            collectionName: 'attempts',
            docId: dto.attemptId,
            data: { status: 'grading_failed' }
          });
        } catch (markErr) {
          logger.error('Also failed to mark attempt as grading_failed', { attemptId: dto.attemptId, error: markErr });
        }
        // 200, not 500, here — otherwise Cloud Tasks keeps retrying past this threshold until
        // its own max-attempts config kicks in, which may not match MAX_RETRY_BEFORE_GIVING_UP.
        return res.status(200).json({ success: false, attemptId: dto.attemptId, gaveUp: true });
      }

      throw new InternalServerError(err.message || String(err));
    }
  })
);

export default router;
