import { clientDb, clientCollection, clientGetDocs } from '../firestoreClient';
import { enqueueWrite } from '../db/writeQueue';
import { DocRecord } from './SchoolDao';

// Shared contract for a flat, admin-curated named list (subject categories, academic levels,
// …) — tenant scoping doesn't apply, these are platform-wide reference data. Read/write role
// gating stays in the controller, same split as every other DAO in this app.
export interface NamedListDao {
  findAll(): Promise<DocRecord[]>;
  create(data: { name: string; createdAt: string }): Promise<{ success: true; id: string }>;
  deleteById(id: string): Promise<{ success: true; id: string }>;
}

// Factory instead of one bespoke class per list — subject_categories and academic_levels are
// identical in shape (flat name + createdAt, no relations), so this is the single
// implementation both real DAOs (FirestoreSubjectCategoryDao.ts, FirestoreAcademicLevelDao.ts)
// are built from.
export function createFirestoreNamedListDao(collectionName: string): NamedListDao {
  return {
    async findAll(): Promise<DocRecord[]> {
      const snap = await clientGetDocs(clientCollection(clientDb, collectionName));
      return snap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() }));
    },

    async create(data: { name: string; createdAt: string }) {
      return enqueueWrite({ type: 'add', collectionName, data });
    },

    async deleteById(id: string) {
      return enqueueWrite({ type: 'delete', collectionName, docId: id });
    }
  };
}
