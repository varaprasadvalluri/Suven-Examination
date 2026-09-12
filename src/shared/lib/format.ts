/**
 * Display formatting shared across screens.
 *
 * These existed as inline expressions repeated across ~20 components, and the copies had
 * quietly diverged: some guarded division by zero, some did not (producing NaN% on screen),
 * some clamped to 100 and some did not. A single implementation makes the guard the default
 * rather than something each call site has to remember.
 */

/** Rendered in place of a value that is missing or unparseable. */
export const NOT_AVAILABLE = 'N/A';

export interface PercentageOptions {
  /** Cap the result at 100. Off by default — a growth figure may legitimately exceed it. */
  clamp?: boolean;
  /** Returned when `total` is zero/absent, where a percentage is undefined rather than 0. */
  fallback?: number;
}

/**
 * `value` as a whole-number percentage of `total`.
 *
 * A zero or missing `total` yields `fallback` (0 by default) rather than NaN or Infinity —
 * that is the bug this replaces: `Math.round((score / exam.totalMarks) * 100)` renders
 * "NaN%" for an exam whose total marks were never set.
 */
export function percentage(value: number, total: number, options: PercentageOptions = {}): number {
  const { clamp = false, fallback = 0 } = options;
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return fallback;
  const pct = Math.round((value / total) * 100);
  return clamp ? Math.min(100, Math.max(0, pct)) : pct;
}

/** `percentage()` with a trailing '%', for direct rendering. */
export function percentageLabel(value: number, total: number, options?: PercentageOptions): string {
  return `${percentage(value, total, options)}%`;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  // Firestore timestamps arrive as { seconds } or with a toDate() method depending on path.
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number };
    if (typeof candidate.toDate === 'function') return candidate.toDate();
    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000);
  }
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Date only, in the viewer's locale. `N/A` when absent or unparseable. */
export function formatDate(value: unknown, fallback: string = NOT_AVAILABLE): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString() : fallback;
}

/** Time of day only, in the viewer's locale. */
export function formatTimeOfDay(value: unknown, fallback: string = NOT_AVAILABLE): string {
  const date = toDate(value);
  return date ? date.toLocaleTimeString() : fallback;
}

/** Date and time together, in the viewer's locale. */
export function formatDateTime(value: unknown, fallback: string = NOT_AVAILABLE): string {
  const date = toDate(value);
  return date ? date.toLocaleString() : fallback;
}
