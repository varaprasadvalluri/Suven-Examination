import { describe, it, expect } from 'vitest';
import { isAttemptFinished, isAttemptGraded, isReopenedBySchoolLink } from './attemptStatus';

describe('isAttemptFinished', () => {
  it('treats a handed-in-but-ungraded attempt as finished', () => {
    // Grading is asynchronous, so testing `status === 'completed'` alone left a window in
    // which a student could re-enter the exam they had just submitted.
    expect(isAttemptFinished('submitted')).toBe(true);
    expect(isAttemptFinished('completed')).toBe(true);
    expect(isAttemptFinished('grading_failed')).toBe(true);
    expect(isAttemptFinished('in-progress')).toBe(false);
    expect(isAttemptFinished(undefined)).toBe(false);
  });

  it('is wider than isAttemptGraded, which gates the answer key', () => {
    expect(isAttemptGraded('submitted')).toBe(false);
    expect(isAttemptGraded('completed')).toBe(true);
  });
});

describe('isReopenedBySchoolLink', () => {
  const finished = { startTime: '2026-09-01T09:00:00.000Z', endTime: '2026-09-01T11:00:00.000Z' };

  it('re-opens an attempt handed in before the grant', () => {
    expect(isReopenedBySchoolLink(finished, '2026-09-02T10:00:00.000Z')).toBe(true);
  });

  it('does not re-open an attempt handed in after the grant', () => {
    // This is what stops one grant being reusable: a student who re-sits and submits again
    // is locked out until the school grants once more.
    expect(isReopenedBySchoolLink(finished, '2026-08-30T10:00:00.000Z')).toBe(false);
  });

  it('grants nothing when the school never issued one', () => {
    expect(isReopenedBySchoolLink(finished, null)).toBe(false);
    expect(isReopenedBySchoolLink(finished, undefined)).toBe(false);
  });

  it('falls back to startTime when the attempt never recorded an endTime', () => {
    // A server-side/auto submission or a grading_failed record can reach a terminal status
    // without one.
    expect(isReopenedBySchoolLink({ startTime: '2026-09-01T09:00:00.000Z' }, '2026-09-02T10:00:00.000Z')).toBe(true);
  });

  it('stops re-opening once the attempt has been reset on the grant', () => {
    // THE SINGLE-USE GUARD. Every re-attempt reset (gatekeeper.ts, StudentDashboard.tsx,
    // StudentLinkEntry.tsx) clears endTime along with score/answers, precisely so this
    // function stops seeing the PREVIOUS sitting's finish time. Leave endTime behind and it
    // stays older than the grant forever: the student re-enters, abandons, the attempt lazily
    // expires without writing a new endTime — and the same grant re-opens it again, and again.
    const reset: { startTime: string; endTime: string | null } = { startTime: '2026-09-03T09:00:00.000Z', endTime: null };
    expect(isReopenedBySchoolLink(reset, '2026-09-02T10:00:00.000Z')).toBe(false);
  });

  it('refuses to re-open on unusable data rather than guessing', () => {
    // Wrongly re-opening lets a student retake a paper they already submitted, which is worse
    // than a school falling back to the per-student "Re-trigger Link" for an odd attempt.
    expect(isReopenedBySchoolLink({}, '2026-09-02T10:00:00.000Z')).toBe(false);
    expect(isReopenedBySchoolLink(null, '2026-09-02T10:00:00.000Z')).toBe(false);
    expect(isReopenedBySchoolLink(finished, 'not-a-date')).toBe(false);
    expect(isReopenedBySchoolLink({ endTime: 'not-a-date' }, '2026-09-02T10:00:00.000Z')).toBe(false);
  });
});
