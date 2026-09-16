import {
  clientDb,
  clientDoc,
  clientGetDoc,
  clientCollection,
  clientQuery,
  clientWhere,
  clientOrderBy,
  clientLimit,
  clientGetDocs
} from './firestoreClient';
import { SingleDocResult, DocRecord } from '../../../application/ports/SchoolDao';
import { ExamDao } from '../../../application/ports/ExamDao';

export class FirestoreExamDao implements ExamDao {
  async findById(examId: string): Promise<SingleDocResult> {
    const snap = await clientGetDoc(clientDoc(clientDb, 'exams', examId));
    if (!snap.exists()) {
      return { id: examId, exists: false };
    }
    return { id: snap.id, exists: true, data: snap.data() };
  }

  async findPublishedForSchool(schoolId: string, maxResults: number): Promise<DocRecord[]> {
    // Same two-query-merge shape as StudentPortal.tsx's client listener: (A) exams explicitly
    // targeted at this school, and (B) recently-published exams generally, to catch exams with
    // no assignedSchoolIds ("everyone") without an unbounded scan.
    const recentQuery = clientQuery(
      clientCollection(clientDb, 'exams'),
      clientWhere('status', '==', 'published'),
      clientOrderBy('createdAt', 'desc'),
      clientLimit(maxResults)
    );
    const recentSnap = await clientGetDocs(recentQuery);
    const merged = new Map<string, DocRecord>();
    recentSnap.docs.forEach((docSnap: any) => merged.set(docSnap.id, { id: docSnap.id, data: docSnap.data() }));

    // Bounded like the query above it. Without a limit this was the one unbounded read left on
    // the student dashboard: a school assigned to every published exam on the platform would
    // pull all of them, on a route the whole cohort loads at login and then polls.
    const targetedQuery = clientQuery(
      clientCollection(clientDb, 'exams'),
      clientWhere('status', '==', 'published'),
      clientWhere('assignedSchoolIds', 'array-contains', schoolId),
      clientLimit(maxResults)
    );
    const targetedSnap = await clientGetDocs(targetedQuery);
    targetedSnap.docs.forEach((docSnap: any) => merged.set(docSnap.id, { id: docSnap.id, data: docSnap.data() }));

    return Array.from(merged.values()).filter((rec) => {
      const assigned = (rec.data as any)?.assignedSchoolIds;
      return !assigned || assigned.length === 0 || assigned.includes(schoolId);
    });
  }
}

export const examDao: ExamDao = new FirestoreExamDao();
