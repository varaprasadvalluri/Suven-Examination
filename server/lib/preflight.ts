import { firebaseConfig, CLOUD_TASKS_LOCATION, CLOUD_TASKS_QUEUE, CLOUD_RUN_SERVICE_URL } from '../config';

export interface PreflightResult {
  fatal: string[];
  warnings: string[];
}

/**
 * Boot-time production configuration check.
 *
 * Every item here is something that fails SILENTLY or CONFUSINGLY at runtime rather than at
 * startup — which is the worst time to discover it, because "the worst time" is an exam window
 * with tens of thousands of students already logged in. `cloudbuild.yaml` sets no environment
 * variables on the service, so all of these depend on having been configured on the Cloud Run
 * service itself (a deploy without --set-env-vars preserves whatever is already there, so they
 * may well be set — this verifies it rather than assuming either way).
 */
export function checkProductionConfig(env: NodeJS.ProcessEnv = process.env): PreflightResult {
  const fatal: string[] = [];
  const warnings: string[] = [];

  // JWT_SECRET is the one that silently destroys authentication under clustering.
  // config.ts generates a random per-process key when it is unset. That is fine for a single
  // dev process, but production forks one worker per vCPU across up to 100 instances — so up
  // to 200 different signing keys. A session token minted by one worker fails verification on
  // every other one, which surfaces to students as random, unreproducible logouts mid-exam.
  if (!env.JWT_SECRET) {
    fatal.push(
      'JWT_SECRET is not set. Each cluster worker would generate its own random signing key, ' +
        'so a session issued by one worker is rejected by every other one — students would be ' +
        'logged out at random mid-exam. Set JWT_SECRET on the Cloud Run service.'
    );
  }

  if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
    fatal.push('FIREBASE_PROJECT_ID and FIREBASE_API_KEY must be set — every Firestore REST call fails without them.');
  }

  // Not fatal (the app still grades correctly), but it changes the shape of exam-end load
  // completely, so it must not be discovered during one.
  const cloudTasksConfigured = !!(CLOUD_TASKS_LOCATION && CLOUD_TASKS_QUEUE && CLOUD_RUN_SERVICE_URL);
  if (!cloudTasksConfigured) {
    warnings.push(
      'Cloud Tasks is not configured (GCP_LOCATION / CLOUD_TASKS_QUEUE / CLOUD_RUN_SERVICE_URL). ' +
        'Exam grading will run INLINE on the request thread: every submission then does a full ' +
        'question-set query plus scoring before it can respond, instead of returning immediately ' +
        'and grading in the background. That is survivable at low volume and is the wrong shape ' +
        'for a simultaneous end-of-exam burst — configure the queue before a large exam window.'
    );
  }

  return { fatal, warnings };
}
