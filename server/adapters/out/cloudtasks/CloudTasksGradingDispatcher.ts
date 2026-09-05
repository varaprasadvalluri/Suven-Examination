import { CloudTasksClient } from '@google-cloud/tasks';
import {
  firebaseConfig,
  CLOUD_TASKS_LOCATION,
  CLOUD_TASKS_QUEUE,
  CLOUD_TASKS_INVOKER_SA,
  CLOUD_RUN_SERVICE_URL,
  GRADING_WORKER_PATHS
} from '../../../config';
import { GradingDispatcher, GradingTaskDto } from '../../../application/ports/GradingDispatcher';
import { GradeAttemptService } from '../../../application/services/GradeAttemptService';

// Durable, cross-instance shock absorber for the exam-submission burst at exam-end, sitting
// in front of the in-process write-batcher (adapters/out/firestore/writeQueue.ts), not
// replacing it — Cloud Tasks provides the piece that batcher can't: a queued grading task
// survives a Cloud Run instance being recycled, and rate-limiting (configured on the queue
// itself, see .env.example) is enforced across ALL instances, not per-instance.
export class CloudTasksGradingDispatcher implements GradingDispatcher {
  private client: CloudTasksClient | null = null;

  // The inline fallback needs the grading use case; it is injected rather than imported as a
  // singleton so this adapter stays constructible in a test without a live queue.
  constructor(private readonly gradeInline: GradeAttemptService) {}

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
  async dispatch(dto: GradingTaskDto): Promise<void> {
    if (!this.isConfigured()) {
      await this.gradeInline.grade(dto);
      return;
    }

    const client = this.getClient();
    const parent = client.queuePath(firebaseConfig.projectId, CLOUD_TASKS_LOCATION!, CLOUD_TASKS_QUEUE!);
    const url = `${CLOUD_RUN_SERVICE_URL}${GRADING_WORKER_PATHS[0]}`;

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
}
