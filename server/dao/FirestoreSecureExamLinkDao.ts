import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs } from '../firestoreClient';
import { DocRecord } from './SchoolDao';
import { SecureExamLinkDao } from './SecureExamLinkDao';

export class FirestoreSecureExamLinkDao implements SecureExamLinkDao {
  async findActiveForSchool(schoolId: string): Promise<DocRecord[]> {
    const activeLinksQuery = clientQuery(
      clientCollection(clientDb, 'secure_exam_links'),
      clientWhere('schoolId', '==', schoolId),
      clientWhere('isActive', '==', true)
    );
    const snap = await clientGetDocs(activeLinksQuery);
    const now = Date.now();
    const unexpiredLinks: DocRecord[] = snap.docs
      .map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() }))
      // isActive alone isn't enough — a school that triggered-and-forgot a link stays
      // "active" forever otherwise. expiresAt (set to the exam's endTime, or +7 days as a
      // fallback, when the link is created — see handleActivateDynamicSecurity) is the real
      // cutoff.
      .filter((rec: DocRecord) => {
        const expiresAt = (rec.data as any)?.expiresAt;
        return !expiresAt || new Date(expiresAt).getTime() > now;
      });
    unexpiredLinks.sort(
      (a, b) => new Date((b.data as any)?.createdAt || 0).getTime() - new Date((a.data as any)?.createdAt || 0).getTime()
    );
    return unexpiredLinks;
  }
}

export const secureExamLinkDao: SecureExamLinkDao = new FirestoreSecureExamLinkDao();
