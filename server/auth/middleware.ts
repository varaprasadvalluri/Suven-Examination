import { verifySessionToken } from './tokens';

export interface RequestAuth {
  uid: string;
  email: string | null;
  role: 'admin' | 'school' | 'student' | string;
  schoolId: string | null;
}

// Resolves the caller's identity from a Bearer session token, without writing a response.
// Shared by the requireSession middleware and routes (like /api/db/query) that only need
// auth conditionally, depending on which collection is being accessed. Pure JWT signature
// verification — no Firestore reads, since role/schoolId are already inside the token.
export async function resolveAuth(req: any): Promise<RequestAuth | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const claims = verifySessionToken(authHeader.split(' ')[1]);
  if (!claims) return null;

  return {
    uid: claims.uid,
    email: claims.email,
    role: claims.role,
    schoolId: claims.schoolId
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
    console.error('[Auth] Session validation error:', err);
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
