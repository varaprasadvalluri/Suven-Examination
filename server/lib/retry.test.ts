import { describe, it, expect, vi } from 'vitest';
import { withRetry, FirestoreRestError } from './retry';

describe('withRetry', () => {
  it('returns the result without retrying when the call succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const wrapped = withRetry('test.op', fn);

    await expect(wrapped()).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments through unchanged', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const wrapped = withRetry('test.op', fn);

    await wrapped({ collectionName: 'attempts' }, 'second-arg');
    expect(fn).toHaveBeenCalledWith({ collectionName: 'attempts' }, 'second-arg');
  });

  it('retries a transient 503 and returns the eventual success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new FirestoreRestError(503, 'unavailable'))
      .mockResolvedValue('recovered');
    const wrapped = withRetry('test.op', fn);

    await expect(wrapped()).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a 429, the contention status Firestore returns under load', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new FirestoreRestError(429, 'too many requests'))
      .mockRejectedValueOnce(new FirestoreRestError(429, 'too many requests'))
      .mockResolvedValue('recovered');
    const wrapped = withRetry('test.op', fn);

    await expect(wrapped()).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 attempts and rethrows the last error', async () => {
    const err = new FirestoreRestError(503, 'still down');
    const fn = vi.fn().mockRejectedValue(err);
    const wrapped = withRetry('test.op', fn);

    await expect(wrapped()).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  // A deterministic failure will be identical on a retry — retrying only burns the caller's
  // latency budget, and for a 403 it would also re-hit an authorization check that already said no.
  it.each([400, 401, 403, 404, 409])('does not retry a deterministic %i', async (status) => {
    const err = new FirestoreRestError(status, 'deterministic');
    const fn = vi.fn().mockRejectedValue(err);
    const wrapped = withRetry('test.op', fn);

    await expect(wrapped()).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a network-level failure (fetch rejects with TypeError)', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue('recovered');
    const wrapped = withRetry('test.op', fn);

    await expect(wrapped()).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a socket reset', async () => {
    const err: any = new Error('read ECONNRESET');
    err.code = 'ECONNRESET';
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('recovered');
    const wrapped = withRetry('test.op', fn);

    await expect(wrapped()).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // The backoff must stay inside the enclosing circuit breaker's 8s timeout, which covers all
  // attempts combined rather than each one — see the budget note in retry.ts.
  it('keeps total backoff well inside the circuit breaker budget', async () => {
    const fn = vi.fn().mockRejectedValue(new FirestoreRestError(503, 'down'));
    const wrapped = withRetry('test.op', fn);

    const started = Date.now();
    await expect(wrapped()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
