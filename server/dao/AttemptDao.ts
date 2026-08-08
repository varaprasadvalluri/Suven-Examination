import { SingleDocResult } from './SchoolDao';

// Data-access contract for `attempts`. Tenant scoping (school/student ownership),
// authorizeWrite, and the duplicate-submission lock all stay in the controller — this is
// pure read/write against the attempt doc.
export interface AttemptDao {
  findById(attemptId: string): Promise<SingleDocResult>;
  submit(attemptId: string, data: any): Promise<{ success: true; id: string }>;
}
