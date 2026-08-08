import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs } from '../firestoreClient';
import { DocRecord } from './SchoolDao';
import { QuestionDao } from './QuestionDao';

export class FirestoreQuestionDao implements QuestionDao {
  async findByExamId(examId: string): Promise<DocRecord[]> {
    const q = clientQuery(clientCollection(clientDb, 'questions'), clientWhere('examId', '==', examId));
    const snap = await clientGetDocs(q);
    return snap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() }));
  }
}

export const questionDao: QuestionDao = new FirestoreQuestionDao();
