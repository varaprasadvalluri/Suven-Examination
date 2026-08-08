import 'dotenv/config';
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

if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  console.warn(
    '[NODE EXPRESS SERVER] FIREBASE_PROJECT_ID/FIREBASE_API_KEY are not set — ' +
    'Firestore REST calls will fail until they are. See .env.example.'
  );
}

export const PORT = 3000;

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
  const generated = crypto.randomBytes(48).toString('hex');
  console.warn(
    '[Auth] JWT_SECRET is not set — generated a random signing key for this process only. ' +
    'Every existing session will be invalidated on the next restart, and multiple server ' +
    'instances would each sign with a different key. Set JWT_SECRET in the environment for ' +
    'any real deployment (see .env.example).'
  );
  return generated;
})();
