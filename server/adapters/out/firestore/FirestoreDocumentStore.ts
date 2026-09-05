import { clientDb, clientDoc, clientGetDoc } from './firestoreClient';
import { enqueueWrite } from './writeQueue';
import { DocumentStore, DocumentWrite } from '../../../application/ports/DocumentStore';
import { SingleDocResult } from '../../../application/ports/SchoolDao';

// Writes go through the same enqueueWrite write-cushion (batched Firestore commits, bounded
// queue depth) as every Firestore*Dao, so the generic proxy path and the typed DAO path share
// one write pipeline rather than competing pipelines with different backpressure behavior.
export class FirestoreDocumentStore implements DocumentStore {
  async getById(collectionName: string, docId: string): Promise<SingleDocResult> {
    const snap = await clientGetDoc(clientDoc(clientDb, collectionName, docId));
    if (!snap.exists()) {
      return { id: docId, exists: false };
    }
    return { id: snap.id, exists: true, data: snap.data() };
  }

  write(write: DocumentWrite): Promise<any> {
    return enqueueWrite(write);
  }
}

export const documentStore: DocumentStore = new FirestoreDocumentStore();
