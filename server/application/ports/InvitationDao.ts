import { DocRecord } from './SchoolDao';

// Data-access contract for `invitations` — the actual per-student access grant a school
// creates via "Trigger Link" / "Re-trigger Link" (SchoolStudentOnboarding.tsx). This is the
// tenant boundary for exam visibility: a student sees an exam as available only if the
// school specifically triggered it for THEM (or them-among-others, one invitation doc per
// student either way) — never because it's merely "published and assigned to their school".
export interface InvitationDao {
  // Active (status:'sent', not yet consumed) invitations for one student, newest first.
  findPendingByStudent(studentId: string): Promise<DocRecord[]>;
  // All invitations (any status) for one school+exam — used by the trigger/re-trigger flow
  // to decide, per student, whether a link already exists.
  findByExam(schoolId: string, examId: string): Promise<DocRecord[]>;
  // Creates an invitation doc under a server-generated token id (also stored as `data.id`,
  // matching the historical client-generated-token shape the invite URL embeds).
  create(invitationId: string, data: any): Promise<{ success: true; id: string }>;
  setStatus(invitationId: string, status: string): Promise<{ success: true; id: string }>;
}
