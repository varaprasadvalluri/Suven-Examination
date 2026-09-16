import type { Attempt } from '../src/types';

export type AttemptStatus = Attempt['status'];

// Shared by the frontend and the server (server/lib/scoreVerification.ts already imports from
// src/lib the same way) so there is ONE definition of "this attempt is over".
//
// Why this exists: grading runs asynchronously, so a submitted attempt passes through
// status='submitted' before it becomes 'completed' (or 'grading_failed' if the worker gave
// up). Every re-entry gate in the app used to test `status === 'completed'` alone, which meant
// that during the grading window an attempt read as "not finished" — a student could re-enter
// the exam they had just submitted and start answering again, and the school-facing link
// gates would have re-issued them an entry link. Testing membership of this set closes that
// window regardless of how long grading takes.
export const TERMINAL_ATTEMPT_STATUSES: readonly AttemptStatus[] = ['submitted', 'completed', 'grading_failed'];

// True once the student has handed the paper in — whether or not grading has finished.
// Use this for anything that asks "may this student still work on this attempt?".
export function isAttemptFinished(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

// Deliberately NARROWER than isAttemptFinished: only a fully graded attempt may reveal the
// answer key (see server/routes/v1/ExamQuestionController.ts and the same gate in
// server/routes/db.ts). A submitted-but-ungraded attempt has no result to explain yet, so
// widening this would hand out correct answers earlier than intended for no benefit.
export function isAttemptGraded(status: string | null | undefined): boolean {
  return status === 'completed';
}

// The whole-school re-attempt grant (Method A's "Allow Re-attempt" in
// SchoolStudentOnboarding.tsx), expressed as a comparison rather than as a flag on every
// attempt.
//
// The per-student grant writes `canReattempt: true` onto one attempt doc, which is fine for
// one student and wrong for a whole school: a 5,000-student school would need 5,000 writes
// on one button click, and the platform target is far larger than that (see the bounded-read/
// write rule this codebase is held to). So the school-wide grant instead writes ONE field,
// `reattemptFrom`, onto the single `secure_exam_links` doc that already exists per
// school+exam, and every gate compares against it.
//
// Comparing timestamps rather than setting a boolean also makes the grant naturally
// single-use per grant: an attempt handed in AFTER the grant was issued is not reopened by
// it, so a student who re-sits and submits again doesn't get let back in a third time until
// the school grants again.
//
// Conservative on missing data: an attempt with no usable finish timestamp is NOT reopened.
// Wrongly reopening lets a student retake a paper they already submitted, which is worse than
// a school falling back to the per-student "Re-trigger Link" for an odd attempt.
export function isReopenedBySchoolLink(
  attempt: { endTime?: string | null; startTime?: string | null } | null | undefined,
  reattemptFrom: string | null | undefined
): boolean {
  if (!attempt || !reattemptFrom) return false;

  const grantedAt = new Date(reattemptFrom).getTime();
  if (Number.isNaN(grantedAt)) return false;

  // endTime is written at submission (ExamInterface.tsx). startTime is the fallback for an
  // attempt that reached a terminal status without one — a server-side/auto submission, or a
  // grading_failed record.
  const finishedAtRaw = attempt.endTime || attempt.startTime;
  if (!finishedAtRaw) return false;

  const finishedAt = new Date(finishedAtRaw).getTime();
  if (Number.isNaN(finishedAt)) return false;

  return finishedAt < grantedAt;
}
