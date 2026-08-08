import { clientDb, clientDoc, clientGetDoc } from '../firestoreClient';
import { enqueueWrite } from '../db/writeQueue';
import { SingleDocResult } from './SchoolDao';
import { AttemptDao } from './AttemptDao';

export class FirestoreAttemptDao implements AttemptDao {
  async findById(attemptId: string): Promise<SingleDocResult> {
    const snap = await clientGetDoc(clientDoc(clientDb, 'attempts', attemptId));
    if (!snap.exists()) {
      return { id: attemptId, exists: false };
    }
    return { id: snap.id, exists: true, data: snap.data() };
  }

  async submit(attemptId: string, data: any): Promise<{ success: true; id: string }> {
    const result = await enqueueWrite({ type: 'update', collectionName: 'attempts', docId: attemptId, data });
    return result;
  }
}

export const attemptDao: AttemptDao = new FirestoreAttemptDao();
