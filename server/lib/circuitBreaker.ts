import CircuitBreaker from 'opossum';

// Shared factory so every external dependency (Firestore REST, GCP APIs, Cloudinary,
// Firebase Storage) gets the same trip/reset behavior instead of hand-rolled retry logic
// per call site. Wrapping preserves the wrapped function's signature and throw/reject
// behavior on the success and normal-failure paths — the only new behavior is failing
// fast (without hitting the network) once a dependency is already known to be down.
export interface BreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
}

const DEFAULT_OPTIONS: Required<BreakerOptions> = {
  timeout: 8000,
  errorThresholdPercentage: 50,
  resetTimeout: 15000
};

export function createBreaker<T extends (...args: any[]) => Promise<any>>(
  name: string,
  fn: T,
  options?: BreakerOptions
): T {
  const breaker = new CircuitBreaker(fn, {
    name,
    ...DEFAULT_OPTIONS,
    ...options
  });

  breaker.on('open', () => console.warn(`[CircuitBreaker:${name}] OPEN — failing fast, dependency looks down`));
  breaker.on('halfOpen', () => console.warn(`[CircuitBreaker:${name}] HALF-OPEN — probing dependency`));
  breaker.on('close', () => console.log(`[CircuitBreaker:${name}] CLOSED — dependency recovered`));

  const wrapped = ((...args: Parameters<T>) => breaker.fire(...args)) as T;
  return wrapped;
}
