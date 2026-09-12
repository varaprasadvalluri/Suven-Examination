/**
 * Builds the Firestore document for a newly created exam.
 *
 * Both exam-authoring screens (AdminCreateExam's wizard and AdminExams' inline creator)
 * assembled this object themselves, identically. The fields that matter are the defaults:
 * an unset release window persists as `null` rather than `''`, and an exam assigned to
 * "global" persists an EMPTY assignedSchoolIds array rather than whatever the form happened
 * to be holding when the mode was switched. Getting either wrong changes which students can
 * see an exam, so it should not be re-derived per screen.
 */
export type ExamAssignmentMode = 'global' | 'specific';

export interface NewExamDraft {
  startTime?: string | null;
  endTime?: string | null;
  assignedSchoolIds: string[];
  [field: string]: unknown;
}

export function buildNewExamDocument(draft: NewExamDraft, mode: ExamAssignmentMode, creatorId: string, now: Date = new Date()) {
  return {
    ...draft,
    creatorId,
    createdAt: now.toISOString(),
    // An empty string is a value Firestore will happily store and every consumer then has to
    // special-case; null is the absence this field actually means.
    startTime: draft.startTime || null,
    endTime: draft.endTime || null,
    status: 'draft',
    // 'global' means every school, which is expressed as no explicit assignment.
    assignedSchoolIds: mode === 'global' ? [] : draft.assignedSchoolIds
  };
}
