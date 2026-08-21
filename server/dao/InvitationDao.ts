import { DocRecord } from './SchoolDao';

// Data-access contract for `invitations` — the actual per-student access grant a school
// creates via "Trigger Link" / "Re-trigger Link" (SchoolStudentOnboarding.tsx). This is the
// tenant boundary for exam visibility: a student sees an exam as available only if the
// school specifically triggered it for THEM (or them-among-others, one invitation doc per
// student either way) — never because it's merely "published and assigned to their school".
export interface InvitationDao {
  // Active (status:'sent', not yet consumed) invitations for one student, newest first.
  findPendingByStudent(studentId: string): Promise<DocRecord[]>;
}
