import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// Session tokens are verified on every authenticated request — the hottest path in the app —
// and they are the only thing standing between a student and someone else's exam data. This
// module had no tests at all.

// No firebase-admin stubs needed: ID token verification moved behind the TokenVerifier port,
// so this module is now pure JWT with no external SDK to keep out of the way.
vi.mock('../../config', () => ({
  JWT_SECRET: 'test-secret-not-a-real-key',
  JWT_SESSION_TTL_SECONDS: 24 * 60 * 60
}));

const SECRET = 'test-secret-not-a-real-key';

const claims = {
  uid: 'student_1',
  role: 'student',
  schoolId: 'school_1',
  email: 'a@b.test',
  sessionId: 'sess_1'
};

describe('session tokens', () => {
  it('round-trips every claim it was given', async () => {
    const { signSessionToken, verifySessionToken } = await import('./tokens');

    const verified = verifySessionToken(signSessionToken(claims));

    expect(verified).toEqual(claims);
  });

  it('rejects a token signed with a different secret', async () => {
    const { verifySessionToken } = await import('./tokens');

    const forged = jwt.sign(claims, 'attacker-secret');

    expect(verifySessionToken(forged)).toBeNull();
  });

  // The classic JWT attack: strip the signature and set alg to none.
  it('rejects an unsigned "alg: none" token', async () => {
    const { verifySessionToken } = await import('./tokens');

    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');

    expect(verifySessionToken(`${header}.${body}.`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { verifySessionToken } = await import('./tokens');

    const expired = jwt.sign(claims, SECRET, { expiresIn: -10 });

    expect(verifySessionToken(expired)).toBeNull();
  });

  it('rejects a token whose payload was tampered with after signing', async () => {
    const { signSessionToken, verifySessionToken } = await import('./tokens');
    const token = signSessionToken(claims);

    // Swap the student's role for admin, leaving the original signature in place.
    const [header, payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    decoded.role = 'admin';
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    expect(verifySessionToken(`${header}.${tamperedPayload}.${signature}`)).toBeNull();
  });

  it.each([['garbage'], [''], ['a.b.c'], ['....']])('rejects the malformed token %j without throwing', async (bad) => {
    const { verifySessionToken } = await import('./tokens');
    expect(verifySessionToken(bad)).toBeNull();
  });

  // uid and role are what every authorization decision downstream is built on.
  it('rejects a validly-signed token that is missing uid or role', async () => {
    const { verifySessionToken } = await import('./tokens');

    expect(verifySessionToken(jwt.sign({ role: 'student' }, SECRET))).toBeNull();
    expect(verifySessionToken(jwt.sign({ uid: 'u1' }, SECRET))).toBeNull();
  });

  it('normalizes a missing schoolId/email to null rather than undefined', async () => {
    const { verifySessionToken } = await import('./tokens');

    const verified = verifySessionToken(jwt.sign({ uid: 'u1', role: 'admin' }, SECRET));

    expect(verified).toMatchObject({ uid: 'u1', role: 'admin', schoolId: null, email: null, sessionId: '' });
  });
});

describe('gatekeeper tickets', () => {
  const ticketClaims = { uid: 'student_1', schoolId: 'school_1', rollNumber: '42' };

  it('round-trips its claims', async () => {
    const { signGatekeeperTicket, verifyGatekeeperTicket } = await import('./tokens');

    expect(verifyGatekeeperTicket(signGatekeeperTicket(ticketClaims))).toEqual(ticketClaims);
  });

  // A ticket and a session token are both signed with the same secret, so the purpose claim is
  // the only thing stopping one from being presented as the other.
  it('refuses a session token presented as a gatekeeper ticket', async () => {
    const { signSessionToken, verifyGatekeeperTicket } = await import('./tokens');

    expect(verifyGatekeeperTicket(signSessionToken(claims))).toBeNull();
  });

  it('refuses a gatekeeper ticket presented as a session token', async () => {
    const { signGatekeeperTicket, verifySessionToken } = await import('./tokens');

    // It has no `role`, so the session verifier must reject it.
    expect(verifySessionToken(signGatekeeperTicket(ticketClaims))).toBeNull();
  });

  it('refuses a ticket with the right purpose but missing identity claims', async () => {
    const { verifyGatekeeperTicket } = await import('./tokens');

    const incomplete = jwt.sign({ purpose: 'gatekeeper-enroll', uid: 'u1' }, SECRET);

    expect(verifyGatekeeperTicket(incomplete)).toBeNull();
  });

  it('refuses an expired ticket', async () => {
    const { verifyGatekeeperTicket } = await import('./tokens');

    const expired = jwt.sign({ ...ticketClaims, purpose: 'gatekeeper-enroll' }, SECRET, { expiresIn: -1 });

    expect(verifyGatekeeperTicket(expired)).toBeNull();
  });
});
