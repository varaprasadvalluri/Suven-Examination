import jwt from 'jsonwebtoken';
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { firebaseConfig, JWT_SECRET, JWT_SESSION_TTL_SECONDS } from '../config';

// Firebase Admin is used ONLY to cryptographically verify client-supplied Firebase Auth ID
// tokens (via public certs, no service-account credential required for verification).
// Firestore access itself still goes through the REST client above via ADC.
//
// In this environment, Firebase Auth and Firestore data can live in DIFFERENT GCP
// projects: the platform auto-provisions a `gen-lang-client-*` project for Auth, while
// Firestore data lives in whatever `firebaseConfig.projectId` points at (see the
// isTargetingPlatformProject comment above for the same split). A token's "aud" claim
// must exactly match the project an admin app was initialized for, so we lazily create
// one admin app per project actually seen — but only for projects on this allowlist, so
// we never silently accept a validly-signed token from some unrelated Firebase project.
export const ALLOWED_AUTH_PROJECT_IDS = Array.from(
  new Set(
    [
      firebaseConfig.projectId,
      'gen-lang-client-0086284509',
      ...(process.env.FIREBASE_AUTH_PROJECT_ID ? [process.env.FIREBASE_AUTH_PROJECT_ID] : [])
    ].filter(Boolean)
  )
);

const adminAppsByProject = new Map<string, ReturnType<typeof initializeAdminApp>>();

export function getAdminAppForProject(projectId: string) {
  let app = adminAppsByProject.get(projectId);
  if (app) return app;
  const appName = `verify-${projectId}`;
  app = getAdminApps().find((existingApp) => existingApp.name === appName) || initializeAdminApp({ projectId }, appName);
  adminAppsByProject.set(projectId, app);
  return app;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string | null; name: string | null }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const tokenProjectId = payload.aud;
  if (!tokenProjectId || !ALLOWED_AUTH_PROJECT_IDS.includes(tokenProjectId)) {
    throw new Error(`ID token audience "${tokenProjectId}" is not an allowed project`);
  }

  const decoded = await getAdminAuth(getAdminAppForProject(tokenProjectId)).verifyIdToken(idToken);
  return { uid: decoded.uid, email: decoded.email || null, name: (decoded.name as string) || null };
}

export interface SessionClaims {
  uid: string;
  role: string;
  schoolId: string | null;
  email: string | null;
  // One-device-at-a-time enforcement: each fresh login writes a new random sessionId here AND
  // to users/{uid}.activeSessionId (see server/auth/middleware.ts's resolveAuth). A token whose
  // sessionId no longer matches the user doc's activeSessionId was superseded by a later login
  // elsewhere and is treated as invalid, even though its JWT signature still verifies fine.
  sessionId: string;
}

export function signSessionToken(claims: SessionClaims): string {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: JWT_SESSION_TTL_SECONDS });
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (!decoded || typeof decoded !== 'object' || !decoded.uid || !decoded.role) return null;
    return {
      uid: decoded.uid as string,
      role: decoded.role as string,
      schoolId: (decoded.schoolId as string) || null,
      email: (decoded.email as string) || null,
      sessionId: (decoded.sessionId as string) || ''
    };
  } catch {
    return null;
  }
}

export interface GatekeeperTicketClaims {
  uid: string;
  schoolId: string;
  rollNumber: string;
}

// Binds /api/gatekeeper/enroll to an identity that was actually verified server-side by
// verify-identity or verify-invite, instead of letting enroll trust a client-asserted
// matchedStudentId/finalSchoolId directly (that gap let anyone impersonate any student by
// just POSTing a uid or a guessable `std_{schoolId}_{rollNumber}` fallback id — see the
// security review that added this). Short-lived: only needs to survive the few seconds
// between "identity verified" and the student clicking through the instructions screen.
const GATEKEEPER_TICKET_TTL_SECONDS = 10 * 60;
const GATEKEEPER_TICKET_PURPOSE = 'gatekeeper-enroll';

export function signGatekeeperTicket(claims: GatekeeperTicketClaims): string {
  return jwt.sign({ ...claims, purpose: GATEKEEPER_TICKET_PURPOSE }, JWT_SECRET, { expiresIn: GATEKEEPER_TICKET_TTL_SECONDS });
}

export function verifyGatekeeperTicket(ticket: string): GatekeeperTicketClaims | null {
  try {
    const decoded = jwt.verify(ticket, JWT_SECRET) as jwt.JwtPayload;
    if (!decoded || typeof decoded !== 'object' || decoded.purpose !== GATEKEEPER_TICKET_PURPOSE) return null;
    if (!decoded.uid || !decoded.schoolId || !decoded.rollNumber) return null;
    return {
      uid: decoded.uid as string,
      schoolId: decoded.schoolId as string,
      rollNumber: decoded.rollNumber as string
    };
  } catch {
    return null;
  }
}
