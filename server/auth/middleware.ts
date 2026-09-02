import { verifySessionToken } from './tokens';
import { clientDb, clientDoc, clientGetDoc } from '../firestoreClient';
import { logger } from '../lib/logger';

export interface RequestAuth {
  uid: string;
  email: string | null;
  role: 'admin' | 'school' | 'student' | string;
  schoolId: string | null;
  sessionId: string;
}

// One-device-at-a-time enforcement (see server/auth/tokens.ts's SessionClaims.sessionId):
// caches each uid's current users/{uid}.activeSessionId so resolveAuth — which runs on every
// single authenticated request, the hottest path in the app — doesn't add a Firestore read per
// request. Same short-TTL-cache shape as authorization.ts's ownerVerificationCache, and the
// same accepted tradeoff: a session revoked by a login elsewhere may keep working on this
// specific server instance for up to the TTL (and, since this cache is in-memory per Cloud Run
// instance, propagation across instances is never instant either way) — acceptable per the
// "old device just stops working on its next request or shortly after" product decision, not a
// live-revocation guarantee.
const ACTIVE_SESSION_CACHE_TTL_MS = 30 * 1000;
const activeSessionCache = new Map<string, { activeSessionId: string | undefined; expiry: number }>();

async function getActiveSessionId(uid: string): Promise<string | undefined> {
  const cached = activeSessionCache.get(uid);
  if (cached && cached.expiry > Date.now()) return cached.activeSessionId;

  const snap = await clientGetDoc(clientDoc(clientDb, 'users', uid));
  const activeSessionId = snap.exists() ? ((snap.data() as any)?.activeSessionId as string | undefined) : undefined;
  activeSessionCache.set(uid, { activeSessionId, expiry: Date.now() + ACTIVE_SESSION_CACHE_TTL_MS });
  return activeSessionId;
}

// Resolves the caller's identity from a Bearer session token, without writing a response.
// Shared by the requireSession middleware and routes (like /api/db/query) that only need
// auth conditionally, depending on which collection is being accessed.
export async function resolveAuth(req: any): Promise<RequestAuth | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const claims = verifySessionToken(authHeader.split(' ')[1]);
  if (!claims) return null;

  // A user doc with no activeSessionId set yet (not created under this feature, or a
  // load-test mock uid with no real Firestore doc at all) is treated as compatible/allowed —
  // enforcement only kicks in once a real login has actually populated the field. Once it IS
  // set, a token whose sessionId doesn't match means a later login elsewhere superseded it.
  const activeSessionId = await getActiveSessionId(claims.uid);
  if (activeSessionId && activeSessionId !== claims.sessionId) {
    return null;
  }

  return {
    uid: claims.uid,
    email: claims.email,
    role: claims.role,
    schoolId: claims.schoolId,
    sessionId: claims.sessionId
  };
}

// Session-based authentication middleware: validates the Bearer session token issued by
// /api/auth/validate, /api/auth/create-profile, or /api/gatekeeper/enroll, and attaches
// the caller's identity/role/schoolId to req.auth for downstream authorization checks.
export async function requireSession(req: any, res: any, next: () => void) {
  try {
    const auth = await resolveAuth(req);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized: Missing, invalid, or expired session' });
    }
    req.auth = auth;
    next();
  } catch (err: any) {
    logger.error('Session validation error', { err });
    return res.status(500).json({ error: err.message || String(err) });
  }
}

// Role gate — use after requireSession.
export function requireRole(...roles: string[]) {
  return (req: any, res: any, next: () => void) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role permissions' });
    }
    next();
  };
}
