import { DocRecord } from './SchoolDao';

// Data-access contract for student documents (`users` collection, role:'student'). Tenant
// scoping and role/field authorization stays in the controller (mirrors authorizeWrite's
// existing 'users' branch) — this interface is pure CRUD, same split as a Spring
// @Repository sitting under a @PreAuthorize-guarded @RestController method.
export interface StudentDao {
  findBySchool(schoolId: string): Promise<DocRecord[]>;
  create(studentFields: any): Promise<any>;
  update(studentId: string, studentFields: any): Promise<any>;
}
