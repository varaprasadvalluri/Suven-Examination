import { CloudTasksClient } from '@google-cloud/tasks';
import { firebaseConfig, CLOUD_TASKS_LOCATION, CLOUD_TASKS_QUEUE, CLOUD_TASKS_INVOKER_SA, CLOUD_RUN_SERVICE_URL } from '../config';
import { recomputeAttemptScore } from './scoreVerification';
import { enqueueWrite } from '../db/writeQueue';
import { clientDb, clientDoc, clientGetDoc } from '../firestoreClient';
import { logger } from './logger';

// The DTO a submission is turned into before grading — deliberately just plain data (no
// Firestore doc references, no class instances), so it survives being serialized into a
// Cloud Task and deserialized again on the worker side unchanged.
export interface GradingTaskDto {
  eventId: string;
  timestamp: string;
  examId: string;
  studentId: string;
  answers: any[];
  attemptId: string;
}

// Durable, cross-instance shock absorber for the exam-submission burst at exam-end, sitting
// in front of the existing in-process write-batcher (server/db/writeQueue.ts), not replacing
// it — Cloud Tasks provides the piece that batcher can't: a queued grading task survives a
// Cloud Run instance being recycled, and rate-limiting (configured on the queue itself, see
// .env.example) is enforced across ALL instances, not per-instance.
class TaskQueueService {
  private client: CloudTasksClient | null = null;

  private getClient(): CloudTasksClient {
    if (!this.client) this.client = new CloudTasksClient();
    return this.client;
  }

  private isConfigured(): boolean {
    return !!(CLOUD_TASKS_LOCATION && CLOUD_TASKS_QUEUE && CLOUD_RUN_SERVICE_URL && firebaseConfig.projectId);
  }

  // Queues a grading task for /api/internal/grade-attempt to pick up. If Cloud Tasks isn't
  // configured (local dev, or this sandbox — no real GCP queue provisioned), grades inline
  // instead of erroring, same fail-safe-default pattern as LOAD_TEST_SECRET in config.ts.
  async enqueueGradingTask(dto: GradingTaskDto): Promise<void> {
    if (!this.isConfigured()) {
      await this.gradeAttempt(dto);
      return;
    }

    const client = this.getClient();
    const parent = client.queuePath(firebaseConfig.projectId, CLOUD_TASKS_LOCATION!, CLOUD_TASKS_QUEUE!);
    const url = `${CLOUD_RUN_SERVICE_URL}/api/v1/internal/grading-tasks`;

    await client.createTask({
      parent,
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify(dto)).toString('base64'),
          // Lets the worker route verify (via verifyCloudTasksAuth) that this call genuinely
          // came from Cloud Tasks and not an arbitrary caller who guessed the URL.
          ...(CLOUD_TASKS_INVOKER_SA ? { oidcToken: { serviceAccountEmail: CLOUD_TASKS_INVOKER_SA, audience: url } } : {})
        }
      }
    });
  }

  // The actual grading work — called either by the worker route on a real Cloud Tasks
  // dispatch, or directly by enqueueGradingTask's local-dev fallback above. Reuses
  // recomputeAttemptScore and enqueueWrite unchanged; this class only orchestrates.
  async gradeAttempt(dto: GradingTaskDto): Promise<void> {
    // Grade-and-write is only valid while the attempt is still the one that was submitted.
    // Two ways it might not be by the time this runs:
    //   - A school re-triggered the attempt (SchoolStudentOnboarding / the attempts-trigger
    //     route) during the grading window, resetting it to status='started' with empty
    //     answers. Writing the old grade over that would resurrect a stale score on an attempt
    //     the student is actively retaking.
    //   - Cloud Tasks redelivered a task that already succeeded (at-least-once delivery).
    // Checking the current status first makes this write idempotent and ordering-safe. One
    // extra read per grading task, on a path that is already off the request thread.
    const attemptSnap = await clientGetDoc(clientDoc(clientDb, 'attempts', dto.attemptId));
    if (!attemptSnap.exists()) {
      logger.warn('Skipping grading: attempt no longer exists', { attemptId: dto.attemptId });
      return;
    }
    const currentStatus = (attemptSnap.data() as any)?.status;
    if (currentStatus !== 'submitted') {
      logger.warn('Skipping grading: attempt is no longer awaiting grading', {
        attemptId: dto.attemptId,
        currentStatus
      });
      return;
    }

    const verified = await recomputeAttemptScore(dto.attemptId, dto.answers);
    await enqueueWrite({
      type: 'update',
      collectionName: 'attempts',
      docId: dto.attemptId,
      data: { status: 'completed', score: verified.score, accuracy: verified.accuracy }
    });
  }
}

export const taskQueueService = new TaskQueueService();
