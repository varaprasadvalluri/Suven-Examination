import { describe, it, expect } from 'vitest';
import { percentage, percentageLabel, formatDate, formatDateTime, formatTimeOfDay, NOT_AVAILABLE } from './format';

describe('percentage', () => {
  it('rounds to a whole number', () => {
    expect(percentage(1, 3)).toBe(33);
    expect(percentage(2, 3)).toBe(67);
  });

  // The actual defect this replaces: an exam with totalMarks unset rendered "NaN%".
  it('returns the fallback rather than NaN when the total is zero or missing', () => {
    expect(percentage(40, 0)).toBe(0);
    expect(percentage(40, undefined as unknown as number)).toBe(0);
    expect(percentage(40, 0, { fallback: -1 })).toBe(-1);
  });

  it('does not clamp by default, so growth figures survive', () => {
    expect(percentage(150, 100)).toBe(150);
    expect(percentage(150, 100, { clamp: true })).toBe(100);
  });

  it('clamps negatives only when asked', () => {
    expect(percentage(-10, 100)).toBe(-10);
    expect(percentage(-10, 100, { clamp: true })).toBe(0);
  });

  it('labels with a trailing percent sign', () => {
    expect(percentageLabel(1, 2)).toBe('50%');
  });
});

describe('date formatting', () => {
  const iso = '2026-03-04T10:30:00.000Z';

  it('formats ISO strings, Date objects and epoch millis alike', () => {
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString());
    expect(formatDate(new Date(iso))).toBe(new Date(iso).toLocaleDateString());
    expect(formatDateTime(new Date(iso).getTime())).toBe(new Date(iso).toLocaleString());
  });

  // Firestore hands timestamps back in two different shapes depending on the read path.
  it('accepts Firestore timestamp shapes', () => {
    const seconds = Math.floor(new Date(iso).getTime() / 1000);
    expect(formatDate({ seconds })).toBe(new Date(seconds * 1000).toLocaleDateString());
    expect(formatDate({ toDate: () => new Date(iso) })).toBe(new Date(iso).toLocaleDateString());
  });

  it.each([null, undefined, '', 'not a date'])('falls back for %p', (bad) => {
    expect(formatDate(bad)).toBe(NOT_AVAILABLE);
    expect(formatDateTime(bad)).toBe(NOT_AVAILABLE);
    expect(formatTimeOfDay(bad)).toBe(NOT_AVAILABLE);
  });

  it('honours a caller-supplied fallback', () => {
    expect(formatDate(null, '—')).toBe('—');
  });
});
