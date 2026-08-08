import { DocRecord } from './SchoolDao';

// Data-access contract for the `login_options` collection.
export interface LoginOptionsDao {
  findAll(): Promise<DocRecord[]>;
}
