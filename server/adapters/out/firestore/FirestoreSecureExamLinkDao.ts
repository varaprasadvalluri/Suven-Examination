import { clientDb, clientCollection, clientQuery, clientWhere, clientLimit, clientGetDocs } from './firestoreClient';
import { DocRecord } from '../../../application/ports/SchoolDao';
import { SecureExamLinkDao } from '../../../application/ports/SecureExamLinkDao';

// A school has one link per exam it has triggered, and only the ones still active and
// unexpired matter — a working number is single digits, not hundreds. The cap is here so that
// a school that has triggered-and-forgotten for years cannot turn the student dashboard's read
// into an unbounded one, on a route the whole cohort polls.
//
// A cap without an orderBy, deliberately: ordering by createdAt would make Firestore drop every
// document that lacks the field, and while handleActivateDynamicSecurity writes createdAt on
// every activation today, a single legacy link without one would silently disappear from every
// student's dashboard. An arbitrary 200 out of a set that is realistically single digits is the
// safer failure mode than a precise 200 that can exclude real rows. The newest-first ordering
// callers see is still applied below, in memory, over whatever came back.
const MAX_ACTIVE_LINKS_PER_SCHOOL = 200;

export class FirestoreSecureExamLinkDao implements SecureExamLinkDao {
  async findActiveForSchool(schoolId: string): Promise<DocRecord[]> {
    const activeLinksQuery = clientQuery(
      clientCollection(clientDb, 'secure_exam_links'),
      clientWhere('schoolId', '==', schoolId),
      clientWhere('isActive', '==', true),
      clientLimit(MAX_ACTIVE_LINKS_PER_SCHOOL)
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
