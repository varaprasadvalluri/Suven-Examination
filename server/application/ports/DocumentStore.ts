import { SingleDocResult } from './SchoolDao';

export type DocumentWriteType = 'set' | 'update' | 'add' | 'delete';

export interface DocumentWrite {
  type: DocumentWriteType;
  collectionName: string;
  // Required for every type except 'add', where the store assigns the id.
  docId?: string;
  data?: any;
}

// Collection-agnostic document access, for the paths that genuinely cannot name their
// collection up front: the /api/db proxy, and the ownership checks in AuthorizationService
// that must read whatever collection the caller is writing to. Everything with a fixed
// collection should use that collection's own Dao port instead — this is the escape hatch,
// not the default door.
export interface DocumentStore {
  getById(collectionName: string, docId: string): Promise<SingleDocResult>;
  write(write: DocumentWrite): Promise<any>;
}
