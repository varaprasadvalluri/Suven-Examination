import { logger } from '../../../../lib/logger';

// FAST-PATH duplicate-submission guard. Not the correctness guarantee.
//
// This deployment has no Redis, so this Map is per-process: with cluster workers across
// multiple Cloud Run instances it only catches a double-submission when both requests happen
// to land on the same worker. That is genuinely useful — the overwhelmingly common duplicate
// is a student double-tapping Submit, whose two requests arrive milliseconds apart on the same
// keep-alive connection and therefore the same worker — but it cannot be relied on.
//
// The actual guarantee lives one layer down, in AttemptSubmissionService.submit(): it re-reads
// the attempt and refuses to re-submit one that is already finished. That check is against
// Firestore, so it holds no matter which worker or instance handles the second request, and it
// needs no distributed lock. This middleware exists to reject the obvious case cheaply, before
// spending a Firestore read on it.
const localSubmissionLocks = new Map<string, number>();

const LOCK_TTL_MS = 15000;

export async function checkDuplicateSubmission(req: any, res: any, next: () => void) {
  const { type, collectionName, docId, data } = req.body;

  // Detect if this is an exam submission
  const isSubmission = collectionName === 'attempts' && (type === 'update' || type === 'set') && data && data.status === 'completed';

  if (!isSubmission || !docId) {
    return next();
  }

  const lockKey = `exam_submit_lock:${docId}`;
  const now = Date.now();

  if (localSubmissionLocks.has(lockKey) && localSubmissionLocks.get(lockKey)! > now) {
    logger.warn('Duplicate submission blocked by in-process lock', { attemptId: docId });
    return res.status(429).json({
      error: 'Duplicate submission request detected. Your exam submission is already in progress, please wait.',
      code: 'DUPLICATE_SUBMISSION'
    });
  }

  localSubmissionLocks.set(lockKey, now + LOCK_TTL_MS);

  // Periodic cleanup of expired local locks to avoid memory leaks (1% chance per request).
  // At 50,000 students this Map peaks in the low tens of thousands of entries per instance,
  // each a short string plus a number — a few MB against a 4Gi container, and entries expire
  // within 15 seconds of the submission that created them.
  if (Math.random() < 0.01) {
    for (const [key, expiry] of localSubmissionLocks.entries()) {
      if (expiry < now) {
        localSubmissionLocks.delete(key);
      }
    }
  }

  next();
}

// Exported for tests: lets a test start from a known-empty lock table instead of depending on
// whatever previous tests left behind.
export function __resetSubmissionLocks() {
  localSubmissionLocks.clear();
}
