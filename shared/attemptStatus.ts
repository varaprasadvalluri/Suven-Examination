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
