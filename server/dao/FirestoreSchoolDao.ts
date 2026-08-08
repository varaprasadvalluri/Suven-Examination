import { clientDb, clientCollection, clientDoc, clientGetDoc, clientGetDocs } from '../firestoreClient';
import { DocRecord, SchoolDao, SingleDocResult } from './SchoolDao';

// Firestore-backed implementation of SchoolDao — the equivalent of a JDBC-backed
// @Repository impl class in Spring. Pure data access: no auth checks, no caching (that
// stays in the controller, matching where the pre-existing unversioned route puts it).
export class FirestoreSchoolDao implements SchoolDao {
  async findAll(): Promise<DocRecord[]> {
    const snap = await clientGetDocs(clientCollection(clientDb, 'schools'));
    return snap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() }));
  }

  async findById(schoolId: string): Promise<SingleDocResult> {
    const snap = await clientGetDoc(clientDoc(clientDb, 'schools', schoolId));
    if (!snap.exists()) {
      return { id: schoolId, exists: false };
    }
    return { id: snap.id, exists: true, data: snap.data() };
  }
}

// No DI container in this codebase (plain Express, not Spring) — a module-level singleton
// export is the pragmatic equivalent of a Spring `@Autowired` bean.
export const schoolDao: SchoolDao = new FirestoreSchoolDao();
