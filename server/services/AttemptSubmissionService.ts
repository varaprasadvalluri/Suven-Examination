import crypto from 'crypto';
import { RequestAuth } from '../auth/middleware';
import { authorizeWrite } from '../authorization';
import { enqueueWrite } from '../db/writeQueue';
import { taskQueueService } from '../lib/taskQueue';
import { logger } from '../lib/logger';
import { attemptDao } from '../dao';
import { isAttemptFinished } from '../../shared/attemptStatus';

export interface SubmissionResult {
  success: true;
  id: string;
  queued: true;
  // Present only when this call was a duplicate of an already-finished submission. Callers
  // treat it as success; it exists so logs and clients can tell the two apart.
  duplicate?: true;
}

export interface SubmissionDenied {
  ok: false;
  status: number;
  error: string;
}

// THE single implementation of "a student hands in their exam".
//
// There used to be two, reached by three client code paths, and they disagreed about what a
// submitted attempt is: POST /api/v1/attempts/:id/submit recomputed the score inline on the
// request thread and wrote status='completed', while POST /api/db/write persisted the raw
// answers as status='submitted' and queued grading. Any consumer filtering on
// status == 'completed' — results, ranking, merit lists — therefore saw a different population
// depending on which channel a given student's browser happened to use, and a fix applied to
// one path silently left the other wrong. That is the structural condition behind the
// 22 Aug 2026 scoring incident.
//
// Both routes now delegate here. Neither route was removed: ExamInterface.tsx uses the v1 route
// as its primary channel and /api/db/write as its fallback when the primary fails, and taking
// the fallback away would remove a real recovery path on a flaky network.
class AttemptSubmissionService {
  /**
   * Persists the student's own answers immediately as status='submitted' and queues grading.
   *
   * The client's `score`/`accuracy` are stripped before anything is written — never even
   * transiently trusted — and recomputed from the real answer key by the grading worker
   * (server/lib/scoreVerification.ts). Answers themselves ARE trusted: a student legitimately
   * picking a wrong option is not tampering.
   *
   * Grading is queued rather than run inline so a burst of submissions at exam-end doesn't hold
   * one HTTP request per student open for the full recompute-and-write chain. When Cloud Tasks
   * isn't configured (local dev), taskQueueService.enqueueGradingTask falls back to grading
   * inline, so the attempt still reaches 'completed' — just synchronously.
   */
  async submit(
    auth: RequestAuth,
    attemptId: string,
    writeType: 'update' | 'set',
    data: any
  ): Promise<SubmissionResult | SubmissionDenied> {
    // IDEMPOTENCY — this, not the middleware lock, is what makes double submission safe.
    //
    // There is no Redis in this deployment, so the in-process lock in
    // middleware/duplicateSubmission.ts only catches duplicates that land on the same worker.
    // Re-reading the attempt here closes the rest: whichever worker or instance handles a
    // second request sees the same Firestore document, so a resubmit is rejected regardless of
    // routing. Without it, a retried or double-tapped submission would overwrite answers that
    // were already accepted and enqueue a second grading task for the same attempt.
    //
    // Deliberately returns success rather than an error: from the student's point of view
    // their exam IS submitted, and surfacing a failure for a duplicate would be both confusing
    // and, if their first request's response was the one that got lost, actively wrong.
    const existing = await attemptDao.findById(attemptId);
    if (existing.exists && isAttemptFinished((existing.data as any)?.status)) {
      logger.info('Ignoring duplicate submission for an already-finished attempt', {
        attemptId,
        studentId: auth.uid,
        currentStatus: (existing.data as any)?.status
      });
      return { success: true, id: attemptId, queued: true, duplicate: true };
    }

    const { score: _clientScore, accuracy: _clientAccuracy, ...rest } = data || {};
    const submittedData = { ...rest, status: 'submitted' };

    const decision = await authorizeWrite(auth, writeType, 'attempts', attemptId, submittedData);
    if (decision.ok === false) {
      return { ok: false, status: decision.status, error: decision.error };
    }

    const authorizedData = decision.data;
    await enqueueWrite({ type: writeType, collectionName: 'attempts', docId: attemptId, data: authorizedData });

    // examId/studentId are supplementary metadata for the task payload and logging — grading
    // re-reads the attempt doc by attemptId regardless, so it does not depend on these being
    // present or correct.
    await taskQueueService.enqueueGradingTask({
      eventId: `evt_${crypto.randomBytes(8).toString('hex')}`,
      timestamp: new Date().toISOString(),
      examId: authorizedData.examId || data?.examId || '',
      studentId: auth.role === 'student' ? auth.uid : data?.studentId || '',
      answers: data?.answers || [],
      attemptId
    });

    logger.info('Attempt submitted', { attemptId, studentId: auth.uid, role: auth.role });

    return { success: true, id: attemptId, queued: true };
  }
}

export const attemptSubmissionService = new AttemptSubmissionService();
