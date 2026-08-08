export interface DocRecord<T = any> {
  id: string;
  data: T;
}

export interface SingleDocResult<T = any> {
  id: string;
  exists: boolean;
  data?: T;
}

// Data-access contract for the `schools` collection — analogous to a Spring `@Repository`
// interface. No auth/caching/business logic here, that stays in the controller layer
// (server/routes/v1/SchoolController.ts), same separation Spring Boot draws between a
// @RestController and a JDBC-backed @Repository.
export interface SchoolDao {
  findAll(): Promise<DocRecord[]>;
  findById(schoolId: string): Promise<SingleDocResult>;
}
