import { clientDb, clientCollection, clientGetDocs } from '../firestoreClient';
import { DocRecord } from './SchoolDao';
import { LoginOptionsDao } from './LoginOptionsDao';

export class FirestoreLoginOptionsDao implements LoginOptionsDao {
  async findAll(): Promise<DocRecord[]> {
    const snap = await clientGetDocs(clientCollection(clientDb, 'login_options'));
    return snap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() }));
  }
}

export const loginOptionsDao: LoginOptionsDao = new FirestoreLoginOptionsDao();
