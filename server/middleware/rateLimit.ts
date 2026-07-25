import rateLimit from 'express-rate-limit';

// Load-test requests (x-load-test header, already trusted elsewhere in the app — see
// gatekeeper.ts/db.ts isLoadTestRequest checks) are exempt so intentional stress testing
// isn't throttled by the same limits meant to stop abuse.
const skipLoadTest = (req: any) => req.headers['x-load-test'] === 'true';

// Public, unauthenticated identity/invite lookup routes (verify-identity, invite-metadata,
// verify-invite) — legitimate students may retry a few times on typos, but no reason for
// more than a handful of attempts per minute from one IP.
export const gatekeeperLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLoadTest,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});

// Enroll actually creates/mutates a student + attempt record — same window, slightly
// tighter cap since it's a write, not just a lookup.
export const gatekeeperEnrollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLoadTest,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});

// Cloudinary upload costs real quota/money per call — stricter cap.
export const cloudinaryUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests. Please wait a few minutes and try again.' }
});
