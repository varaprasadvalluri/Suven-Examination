import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs } from '../firestoreClient';
import { enqueueWrite } from '../db/writeQueue';
import { DocRecord } from './SchoolDao';
import { InvitationDao } from './InvitationDao';

export class FirestoreInvitationDao implements InvitationDao {
  async findPendingByStudent(studentId: string): Promise<DocRecord[]> {
    const pendingInvitationsQuery = clientQuery(
      clientCollection(clientDb, 'invitations'),
      clientWhere('studentId', '==', studentId),
      clientWhere('status', '==', 'sent')
    );
    const snap = await clientGetDocs(pendingInvitationsQuery);
    const invitations: DocRecord[] = snap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() }));
    invitations.sort((a, b) => new Date((b.data as any)?.createdAt || 0).getTime() - new Date((a.data as any)?.createdAt || 0).getTime());
    return invitations;
  }

  async findByExam(schoolId: string, examId: string): Promise<DocRecord[]> {
    const examInvitationsQuery = clientQuery(
      clientCollection(clientDb, 'invitations'),
      clientWhere('schoolId', '==', schoolId),
      clientWhere('examId', '==', examId)
    );
    const snap = await clientGetDocs(examInvitationsQuery);
    return snap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() }));
  }

  async create(invitationId: string, data: any): Promise<{ success: true; id: string }> {
    return enqueueWrite({ type: 'set', collectionName: 'invitations', docId: invitationId, data });
  }

  async setStatus(invitationId: string, status: string): Promise<{ success: true; id: string }> {
    return enqueueWrite({ type: 'update', collectionName: 'invitations', docId: invitationId, data: { status } });
  }
}

export const invitationDao: InvitationDao = new FirestoreInvitationDao();
