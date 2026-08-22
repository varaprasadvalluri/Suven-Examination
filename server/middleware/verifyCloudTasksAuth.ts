import { OAuth2Client } from 'google-auth-library';
import { CLOUD_RUN_SERVICE_URL, CLOUD_TASKS_INVOKER_SA } from '../config';

const oidcClient = new OAuth2Client();

// Gate for /api/internal/grade-attempt — this is a worker route invoked by Cloud Tasks, not
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
    const audience = `${CLOUD_RUN_SERVICE_URL}/api/internal/grade-attempt`;
    const ticket = await oidcClient.verifyIdToken({ idToken: authHeader.slice('Bearer '.length), audience });
    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({ error: 'Invalid OIDC token' });
    }
    if (CLOUD_TASKS_INVOKER_SA && payload.email !== CLOUD_TASKS_INVOKER_SA) {
      return res.status(403).json({ error: 'Token not issued to the expected service account' });
    }
    next();
  } catch (err: any) {
    console.error('[Cloud Tasks Auth] OIDC verification failed:', err);
    return res.status(401).json({ error: 'OIDC token verification failed' });
  }
}
