import { GradingTaskDto } from '../ports/GradingDispatcher';
import { AttemptDao } from '../ports/AttemptDao';
import { ScoreVerificationService } from './scoreVerification';
import { logger } from '../../lib/logger';

// The actual grading work — reached either by the worker route on a real queue dispatch, or
// directly by the dispatcher's no-queue-configured fallback. Pure orchestration: the scoring
// rules live in shared/examScoring.ts and the persistence in AttemptDao.
export class GradeAttemptService {
  constructor(
    private readonly attempts: AttemptDao,
    private readonly scoring: ScoreVerificationService
  ) {}

  async grade(dto: GradingTaskDto): Promise<void> {
    // Grade-and-write is only valid while the attempt is still the one that was submitted.
    // Two ways it might not be by the time this runs:
    //   - A school re-triggered the attempt (SchoolStudentOnboarding / the attempts-trigger
    //     route) during the grading window, resetting it to status='started' with empty
    //     answers. Writing the old grade over that would resurrect a stale score on an attempt
    //     the student is actively retaking.
    //   - The queue redelivered a task that already succeeded (at-least-once delivery).
    // Checking the current status first makes this write idempotent and ordering-safe. One
    // extra read per grading task, on a path that is already off the request thread.
    const attempt = await this.attempts.findById(dto.attemptId);
    if (!attempt.exists) {
      logger.warn('Skipping grading: attempt no longer exists', { attemptId: dto.attemptId });
      return;
    }
    const currentStatus = (attempt.data as any)?.status;
    if (currentStatus !== 'submitted') {
      logger.warn('Skipping grading: attempt is no longer awaiting grading', {
        attemptId: dto.attemptId,
        currentStatus
      });
      return;
    }

    const verified = await this.scoring.recompute(dto.attemptId, dto.answers);
    await this.attempts.update(dto.attemptId, {
      status: 'completed',
      score: verified.score,
      accuracy: verified.accuracy
    });
  }
}
