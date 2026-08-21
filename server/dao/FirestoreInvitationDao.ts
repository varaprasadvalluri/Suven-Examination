import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs } from '../firestoreClient';
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
}

export const invitationDao: InvitationDao = new FirestoreInvitationDao();
