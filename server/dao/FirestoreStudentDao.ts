import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs } from '../firestoreClient';
import { enqueueWrite } from '../db/writeQueue';
import { DocRecord } from './SchoolDao';
import { StudentDao } from './StudentDao';

// Writes go through the same enqueueWrite write-cushion (batched Firestore commits, bounded
// queue) the rest of the app uses under exam-day load — a DAO wrapping raw per-call Firestore
// writes here would silently regress the scale characteristics the write queue exists for.
export class FirestoreStudentDao implements StudentDao {
  async findBySchool(schoolId: string): Promise<DocRecord[]> {
    const q = clientQuery(
      clientCollection(clientDb, 'users'),
      clientWhere('schoolId', '==', schoolId),
      clientWhere('role', '==', 'student')
    );
    const snap = await clientGetDocs(q);
    return snap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() }));
  }

  async create(data: any): Promise<any> {
    return enqueueWrite({ type: 'add', collectionName: 'users', data });
  }

  async update(studentId: string, data: any): Promise<any> {
    return enqueueWrite({ type: 'update', collectionName: 'users', docId: studentId, data });
  }
}

export const studentDao: StudentDao = new FirestoreStudentDao();
