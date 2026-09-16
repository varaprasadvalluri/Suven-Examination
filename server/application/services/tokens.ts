import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_SESSION_TTL_SECONDS } from '../../config';

// Pure JWT session/ticket minting and verification — no external SDK, no I/O, no clock beyond
// jsonwebtoken's own expiry check. Verifying a client's Firebase ID token lives behind the
// TokenVerifier port (see ./TokenVerifier.ts and ./FirebaseTokenVerifier.ts) instead.

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
