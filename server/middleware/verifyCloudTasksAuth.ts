import { OAuth2Client } from 'google-auth-library';
import { CLOUD_RUN_SERVICE_URL, CLOUD_TASKS_INVOKER_SA, GRADING_WORKER_PATHS } from '../config';
import { logger } from '../lib/logger';

const oidcClient = new OAuth2Client();

// Gate for the grading worker route (GRADING_WORKER_PATHS) — invoked by Cloud Tasks, not
// a student-facing one, so it's verified differently from requireSession (server/auth/
// middleware.ts): Cloud Tasks attaches a Google-signed OIDC ID token (configured in
// server/lib/taskQueue.ts's httpRequest.oidcToken) instead of one of this app's own session
// JWTs. Verifying it here (audience + signature + optionally the exact service account)
// stops anyone who guesses this URL from queuing arbitrary grading writes.
export async function verifyCloudTasksAuth(req: any, res: any, next: () => void) {
  if (!CLOUD_RUN_SERVICE_URL) {
    // Cloud Tasks isn't configured on this deployment — enqueueGradingTask() never actually
    // dispatches a task in that case (it grades inline instead, see taskQueue.ts), so a real
    // request reaching this route without that config is unexpected. Reject defensively
    // rather than skip verification.
    return res.status(503).json({ error: 'Cloud Tasks is not configured on this deployment' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing OIDC token' });
  }

  try {
    // Every path this route is mounted at, because an OIDC audience is the task's target URL
    // verbatim. This used to be a single hardcoded string naming the LEGACY alias while
    // taskQueue.ts dispatched to the v1 path — so verifyIdToken threw on the audience mismatch
    // and rejected every genuine Cloud Tasks dispatch with a 401. Cloud Tasks then retried,
    // failed identically, and eventually gave up: in a deployment with Cloud Tasks actually
    // configured, no attempt was ever graded, and every submission stayed at
    // status:'submitted' forever. It could not show up in local dev or the sandbox, where
    // enqueueGradingTask grades inline instead of dispatching (see taskQueue.ts).
    const audience = GRADING_WORKER_PATHS.map((workerPath) => `${CLOUD_RUN_SERVICE_URL}${workerPath}`);
    const ticket = await oidcClient.verifyIdToken({ idToken: authHeader.slice('Bearer '.length), audience: audience as string[] });
    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({ error: 'Invalid OIDC token' });
    }
    if (CLOUD_TASKS_INVOKER_SA && payload.email !== CLOUD_TASKS_INVOKER_SA) {
      return res.status(403).json({ error: 'Token not issued to the expected service account' });
    }
    next();
  } catch (err: any) {
    logger.error('Cloud Tasks OIDC verification failed', { err });
    return res.status(401).json({ error: 'OIDC token verification failed' });
  }
}
