import { logger } from './logger';

// Retry with full-jitter exponential backoff, for transient dependency failures.
//
// This complements the circuit breaker rather than duplicating it. The breaker handles the
// SUSTAINED failure case: once a dependency is known down, stop calling it. It does nothing
// for the far more common case — a single transient 429/503/ABORTED, which Firestore returns
// routinely under write contention on a hot collection. Before this, one of those became a
// user-visible error on the first attempt, and enough of them inside the breaker's window
// tripped it, escalating a blip into a full outage.
//
// Composition order is deliberate: retry goes INSIDE the breaker (createBreaker(name,
// withRetry(impl))), so a call that fails once and succeeds on retry is reported to the
// breaker as a success. Wrapping the other way round would count every transient blip toward
// the trip threshold, which is exactly the escalation this is meant to prevent.

// 429 = quota/contention, 500/502/503/504 = transient backend or gateway failures. Everything
// else (400 malformed, 401/403 auth, 404 missing, 409 conflict) is a deterministic answer that
// will be identical on a retry, so retrying only wastes the caller's latency budget.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// BUDGET NOTE: the enclosing circuit breaker's `timeout` (8s by default, see
// lib/circuitBreaker.ts) is the ceiling for ALL attempts plus their backoff combined, not per
// attempt — the breaker sees one call. With these values the backoff itself contributes at
// most ~300ms, leaving the budget to the three requests. Raising MAX_ATTEMPTS or the delays
// without also raising that breaker timeout would make slow-but-not-failing calls get killed
// by the breaker mid-retry.
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 100;
const MAX_DELAY_MS = 2000;

export class FirestoreRestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'FirestoreRestError';
    this.status = status;
  }
}

function isRetryable(err: any): boolean {
  if (err instanceof FirestoreRestError) {
    return RETRYABLE_STATUS.has(err.status);
  }
  // fetch() rejects with a TypeError on DNS failure, connection reset, socket hang-up — all
  // transient by nature and safe to retry for the idempotent operations this wraps.
  return err instanceof TypeError || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.code === 'ENOTFOUND';
}

// Full jitter (random between 0 and the capped exponential window), not fixed backoff.
// At exam scale this is the point of the whole function: tens of thousands of clients
// autosaving on the same ~30s cadence will hit a Firestore blip at the same moment, and a
// deterministic backoff would have all of them retry in lockstep and re-create the thundering
// herd that caused the blip.
function backoffDelayMs(attempt: number): number {
  const window = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.random() * window;
}

/**
 * Wraps an IDEMPOTENT async operation with bounded retries. Preserves the wrapped function's
 * signature and its throw behavior once retries are exhausted.
 *
 * Only ever apply this to operations that are safe to run twice. Notably NOT clientAddDoc:
 * it POSTs to a collection and lets Firestore assign the document ID, so retrying a request
 * that actually succeeded but whose response was lost would silently create a duplicate
 * document rather than converge on the same one.
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(name: string, fn: T): T {
  const wrapped = async (...args: Parameters<T>) => {
    let lastError: any;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await fn(...args);
      } catch (err: any) {
        lastError = err;
        if (!isRetryable(err) || attempt === MAX_ATTEMPTS - 1) {
          throw err;
        }
        const delay = backoffDelayMs(attempt);
        logger.warn('Retrying transient dependency failure', {
          operation: name,
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
          delayMs: Math.round(delay),
          status: err instanceof FirestoreRestError ? err.status : undefined,
          error: err
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  };

  return wrapped as T;
}
