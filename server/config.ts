import './loadEnv';
import crypto from 'crypto';

// Single source of truth for Firebase config — env vars only (same names the frontend
// build reads via vite.config.ts's `define` block, so there's one place to set these,
// not a checked-in JSON file plus a separate copy for the client bundle).
export const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
  apiKey: process.env.FIREBASE_API_KEY || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || ''
};

// The two console.warn calls in this file are deliberate: config is evaluated at module load,
// before any request context exists for the structured logger to attach, and a bootstrap
// misconfiguration should be readable even if nothing else has initialised yet. Everything
// that runs per-request uses logger from lib/logger.
if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.warn(
    '[NODE EXPRESS SERVER] FIREBASE_PROJECT_ID/FIREBASE_API_KEY are not set — ' +
      'Firestore REST calls will fail until they are. See .env.example.'
  );
}

// Cloud Run injects PORT into the container and expects the server to bind whatever it says.
// The Dockerfile happens to set PORT=3000 and the deploy passes --port 3000, so a hardcoded
// 3000 works today — but it would break silently the moment either of those changes. Read the
// env var and keep 3000 as the local-dev default.
export const PORT = parseInt(process.env.PORT || '3000', 10);

// One place decides what "production" means, so the checks below and anything added later
// cannot drift apart on their own NODE_ENV comparisons.
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Gates the load-test bypass in /api/gatekeeper/enroll (see load-test.cjs). Previously that
// bypass triggered on the client-supplied `x-load-test: true` header OR substrings like
// "test-roll-"/"StressTester" in request body fields — all fully attacker-controlled, with
// no secret required, letting anyone mint a real, verifiable student session token for free
// with zero enrollment. Requiring this env-configured secret (never client-suppliable) fixes
// that; leaving it unset disables the bypass entirely (fail-closed) rather than falling back
// to an insecure default.
export const LOAD_TEST_SECRET: string | null = process.env.LOAD_TEST_SECRET || null;

// App-level sessions (as opposed to the Firebase ID token used only once, to call
// /api/auth/validate) are signed JWTs, not opaque tokens looked up in Firestore. This
// means requireSession/resolveAuth — which runs on every /api/db/query and /api/db/write
// call, i.e. the highest-traffic code path in the app during an exam window — does zero
// Firestore reads: just signature + expiry verification. At up to ~100k concurrent
// students autosaving every ~30s, that's the difference between 2 reads/request and 0.
//
// Trade-off: a JWT can't be revoked server-side without extra bookkeeping, so a role/
// schoolId change only takes effect the next time the affected user's session is reissued
// (next login, or completing RoleSelection/create-profile/toggleSchoolContext — all of
// which already mint a fresh token and the frontend already reloads/re-stores it after
// each of those). Given role changes are rare and happen at well-defined points, not
// continuously, this is an acceptable trade for removing the per-request DB cost.
export const JWT_SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h — matches the previous Firestore session TTL

export const JWT_SECRET: string = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  // In production the random-key fallback is not a degraded mode, it is a broken one: this
  // deployment runs one worker per vCPU across multiple Cloud Run instances, so each worker
  // would sign with a different key and reject every other worker's tokens. Students would be
  // logged out at random mid-exam depending on which instance answered the request, and the
  // cause would look like an intermittent auth bug rather than a missing env var. Refuse to
  // boot instead — a container that fails to start is loud, and Cloud Run keeps the previous
  // healthy revision serving.
  if (IS_PRODUCTION) {
    throw new Error(
      '[Auth] JWT_SECRET must be set in production. Without it each server instance signs ' +
        'sessions with a different random key, so tokens minted by one instance are rejected ' +
        'by every other one. Set JWT_SECRET in the environment (see .env.example).'
    );
  }

  const generated = crypto.randomBytes(48).toString('hex');
  console.warn(
    '[Auth] JWT_SECRET is not set — generated a random signing key for this process only. ' +
      'Every existing session will be invalidated on the next restart, and multiple server ' +
      'instances would each sign with a different key. Set JWT_SECRET in the environment for ' +
      'any real deployment (see .env.example).'
  );
  return generated;
})();

// Cloud Tasks config for async exam-grading (see server/lib/taskQueue.ts). Left unset in
// local dev / this sandbox on purpose — enqueueGradingTask() falls back to grading inline
// when CLOUD_TASKS_QUEUE isn't configured, same fail-safe-default pattern as
// LOAD_TEST_SECRET above, rather than crashing when no real GCP queue exists yet.
// Source project for the one-off legacy data migration (/api/db/migrate). This used to be a
// hardcoded object in server/routes/adminDb.ts, including a live Firebase API key checked
// into the repo. Firebase web keys are not secrets by design, but keeping project identifiers
// in source is how a migration route ends up quietly pointed at the wrong project after a
// rename. Unset by default: the route now requires an explicit sourceConfigOverride when
// these are absent, rather than silently defaulting to some project nobody remembers.
export const LEGACY_MIGRATION_SOURCE = {
  projectId: process.env.LEGACY_FIREBASE_PROJECT_ID || '',
  appId: process.env.LEGACY_FIREBASE_APP_ID || '',
  apiKey: process.env.LEGACY_FIREBASE_API_KEY || '',
  authDomain: process.env.LEGACY_FIREBASE_AUTH_DOMAIN || '',
  firestoreDatabaseId: process.env.LEGACY_FIRESTORE_DATABASE_ID || '',
  storageBucket: process.env.LEGACY_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.LEGACY_FIREBASE_MESSAGING_SENDER_ID || ''
};

export const CLOUD_TASKS_LOCATION: string | null = process.env.GCP_LOCATION || null;
export const CLOUD_TASKS_QUEUE: string | null = process.env.CLOUD_TASKS_QUEUE || null;
export const CLOUD_TASKS_INVOKER_SA: string | null = process.env.CLOUD_TASKS_INVOKER_SA || null;
// Base URL this service is reachable at — used both as the Cloud Task's target URL and as
// the OIDC audience the worker route verifies incoming tokens against. Those two have to agree
// EXACTLY (an OIDC audience is compared as a string), so the trailing slash is stripped here
// rather than left to each caller: with it, the enqueuer would mint a token for
// `https://svc//api/...` and the verifier would expect `https://svc/api/...`.
export const CLOUD_RUN_SERVICE_URL: string | null = process.env.CLOUD_RUN_SERVICE_URL?.replace(/\/+$/, '') || null;

// The paths the Cloud Tasks worker route is mounted at (server/routes/internal.ts). The
// enqueuer targets the first; both are accepted as OIDC audiences so the legacy alias keeps
// working. Exported so the enqueuer and the verifier cannot drift apart again — they did:
// taskQueue.ts dispatched to /api/v1/internal/grading-tasks while verifyCloudTasksAuth.ts
// checked the audience against /api/internal/grade-attempt, so every real dispatch was
// rejected 401.
export const GRADING_WORKER_PATHS = ['/api/v1/internal/grading-tasks', '/api/internal/grade-attempt'] as const;
