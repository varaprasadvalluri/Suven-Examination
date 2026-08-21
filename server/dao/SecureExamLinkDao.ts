import { DocRecord } from './SchoolDao';

// Data-access contract for `secure_exam_links` — the school-WIDE trigger ("Method A" in
// SchoolStudentOnboarding.tsx: one doc per schoolId+examId, `isActive` toggled by the
// Trigger Exam/Re-trigger Exam button). This is the bulk counterpart to InvitationDao's
// per-student grant: activating one of these makes that exam visible to every student of
// that school, same explicit-trigger requirement, just school-wide instead of individual.
export interface SecureExamLinkDao {
  findActiveForSchool(schoolId: string): Promise<DocRecord[]>;
}
