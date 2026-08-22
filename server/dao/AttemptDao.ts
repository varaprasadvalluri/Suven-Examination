import { SingleDocResult, DocRecord } from './SchoolDao';
import { PagedResult } from './pagination';

// Data-access contract for `attempts`. Tenant scoping (school/student ownership),
// authorizeWrite, and the duplicate-submission lock all stay in the controller — this is
// pure read/write against the attempt doc.
export interface AttemptDao {
  findById(attemptId: string): Promise<SingleDocResult>;
  submit(attemptId: string, attemptUpdates: any): Promise<{ success: true; id: string }>;
  // Ordered newest-first by startTime. `status` filters to a single attempt status
  // (e.g. 'completed' for a student's exam history) when provided.
  findByStudent(studentId: string, opts: { status?: string; page: number; pageSize: number }): Promise<PagedResult<DocRecord>>;
  // General-purpose list, backing GET /api/v1/attempts. All filters optional/AND-combined;
  // sortBy defaults to startTime desc. Replaces the generic /api/db/query proxy for attempts.
  findByFilters(opts: {
    examId?: string;
    schoolId?: string;
    studentId?: string;
    status?: string;
    sortBy?: 'startTime' | 'score' | 'endTime';
    page: number;
    pageSize: number;
  }): Promise<PagedResult<DocRecord>>;
  // Non-completion update (autosave, violation counts, canReattempt, proctoring flags). Kept
  // separate from submit(), which is specifically the graded-completion path.
  update(attemptId: string, data: any): Promise<{ success: true; id: string }>;
}
