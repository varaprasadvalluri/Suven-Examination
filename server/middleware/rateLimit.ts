import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { LOAD_TEST_SECRET } from '../config';

// PER-PROCESS COUNTERS — KNOW WHAT THIS DOES AND DOESN'T BUY YOU
// ---------------------------------------------------------------
// express-rate-limit's default store keeps counters in the worker's own memory, and this
// deployment has no shared store. With one worker per vCPU across up to 100 Cloud Run
// instances, the effective per-IP ceiling is roughly `limit x workers x instances` — at the
// gatekeeper's 500/15min that is on the order of 100,000 requests per IP per window.
//
// So treat these limits as protection against a single misbehaving client hammering one
// instance, NOT as a defence against a determined distributed attacker. Real abuse protection
// at this scale belongs in front of the app — Cloud Armor rate-limiting rules or Cloud Run's
// own ingress controls — where the counter is genuinely global. Introducing a shared store
// here later (Redis or otherwise) is a one-line `store:` change per limiter.
//
// This is also why nothing in the request path depends on rate limiting for CORRECTNESS.
// Duplicate submission is made safe by an idempotency check against Firestore in
// AttemptSubmissionService, not by a limiter or a lock.

// Load-test requests (x-load-test header, already trusted elsewhere in the app — see
// gatekeeper.ts/db.ts isLoadTestRequest checks) are exempt so intentional stress testing
// isn't throttled by the same limits meant to stop abuse. Must also match LOAD_TEST_SECRET
// — checking the header alone let anyone (not just someone who knows the secret) bypass the
// enroll/lookup rate limits in production just by sending `x-load-test: true`, with no
// server-side secret required. Same trusted-secret pattern already used in gatekeeper.ts/
// db.ts's isLoadTestRequest checks.
const skipLoadTest = (req: any) =>
  !!LOAD_TEST_SECRET && req.headers['x-load-test'] === 'true' && req.headers['x-load-test-secret'] === LOAD_TEST_SECRET;

const commonConfig = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }, // Disables the validation check crash
  // ipKeyGenerator collapses an IPv6 address to its /56 subnet before using it as the rate
  // limit key — without it, a client can bypass the cap by rotating the low bits of their
  // own IPv6 address, since each variant would otherwise count as a distinct "IP".
  keyGenerator: (req: any) => ipKeyGenerator(req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'anonymous')
};

// Raised from 20/30 to 500 ahead of a real exam window (5,000+ students, 11am-2pm, single
// 3-hour start window) — everyone behind one school's network shares one public IP, so any
// school with more than ~20 students starting close together would otherwise get most of its
// students blocked with 429s before they could even begin. 500/15min per IP still bounds a
// real abuse script while comfortably covering a large school's simultaneous start. Revisit
// once real per-school traffic patterns from an actual exam day are known.
export const gatekeeperLookupLimiter = rateLimit({
  ...commonConfig,
  limit: 500,
  skip: skipLoadTest,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});

export const gatekeeperEnrollLimiter = rateLimit({
  ...commonConfig,
  limit: 500,
  skip: skipLoadTest,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});

// Firebase-token-only, pre-session bootstrap routes (/api/auth/validate,
// /api/auth/create-profile) — reachable by anyone with a Firebase ID token, each call
// does a Firestore read/write. Same per-IP cap shape as the gatekeeper limiters above.
export const authLimiter = rateLimit({
  ...commonConfig,
  limit: 100,
  skip: skipLoadTest,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});

export const cloudinaryUploadLimiter = rateLimit({
  ...commonConfig,
  limit: 10,
  message: { error: 'Too many upload requests. Please wait a few minutes and try again.' }
});

export const storageUploadLimiter = rateLimit({
  ...commonConfig,
  limit: 10,
  message: { error: 'Too many upload requests. Please wait a few minutes and try again.' }
});

// Diagnostics sink, not a feature endpoint — a crash-looping client shouldn't be able to
// flood server logs. Low limit is intentional.
export const clientErrorReportLimiter = rateLimit({
  ...commonConfig,
  limit: 20,
  message: { error: 'Too many error reports. Please wait a few minutes and try again.' }
});
