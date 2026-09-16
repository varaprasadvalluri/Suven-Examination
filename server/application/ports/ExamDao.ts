import { SingleDocResult, DocRecord } from './SchoolDao';

// Data-access contract for `exams`. Tenant scoping/authorization stays in the controller —
// this is pure read against exam docs.
export interface ExamDao {
  findById(examId: string): Promise<SingleDocResult>;

  // Published exams visible to a school: explicitly assigned to it, or unassigned/global
  // (assignedSchoolIds empty or absent). ONLY for the "My Exams" locked/Soon preview list —
  // whether a student can actually ATTEMPT an exam is decided entirely by explicit trigger
  // (InvitationDao/SecureExamLinkDao), never by this. Bounded, not client-paginated — mirrors
  // the existing cap used elsewhere in this app for the same query.
  findPublishedForSchool(schoolId: string, maxResults: number): Promise<DocRecord[]>;
}
