import { clientDb, clientDoc, clientGetDoc, clientCollection, clientQuery, clientWhere, clientGetDocs } from '../firestoreClient';
import { enqueueWrite } from '../db/writeQueue';
import { SingleDocResult, DocRecord } from './SchoolDao';
import { AttemptDao } from './AttemptDao';
import { PagedResult, paginateInMemory } from './pagination';

export class FirestoreAttemptDao implements AttemptDao {
  async findById(attemptId: string): Promise<SingleDocResult> {
    const snap = await clientGetDoc(clientDoc(clientDb, 'attempts', attemptId));
    if (!snap.exists()) {
      return { id: attemptId, exists: false };
    }
    return { id: snap.id, exists: true, data: snap.data() };
  }

  async submit(attemptId: string, attemptUpdates: any): Promise<{ success: true; id: string }> {
    const writeResult = await enqueueWrite({ type: 'update', collectionName: 'attempts', docId: attemptId, data: attemptUpdates });
    return writeResult;
  }

  // A single student's attempt history is small enough (bounded by exams they've actually
  // taken) to fetch in one shot and slice in memory here — same fetch-then-paginate shape a
  // Postgres impl would use `ORDER BY start_time DESC LIMIT/OFFSET` for, just without a real
  // OFFSET in the Firestore REST layer this server talks to (see firestoreClient.ts).
  async findByStudent(studentId: string, opts: { status?: string; page: number; pageSize: number }): Promise<PagedResult<DocRecord>> {
    const constraints = [clientWhere('studentId', '==', studentId)];
    if (opts.status) constraints.push(clientWhere('status', '==', opts.status));

    const studentAttemptsQuery = clientQuery(clientCollection(clientDb, 'attempts'), ...constraints);
    const snap = await clientGetDocs(studentAttemptsQuery);
    const attempts: DocRecord[] = snap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() }));

    attempts.sort((a: DocRecord, b: DocRecord) => {
      const aStartTime = new Date((a.data as any)?.startTime || 0).getTime();
      const bStartTime = new Date((b.data as any)?.startTime || 0).getTime();
      return bStartTime - aStartTime;
    });

    return paginateInMemory(attempts, { page: opts.page, pageSize: opts.pageSize });
  }

  // Same fetch-then-sort-then-paginate shape as findByStudent above, just with a wider,
  // caller-selected set of AND-combined filters. Bounded by whatever the caller scopes it to
  // (a single exam, a single school, a single student) so this never becomes an unbounded
  // full-collection scan in practice.
  async findByFilters(opts: {
    examId?: string;
    schoolId?: string;
    studentId?: string;
    status?: string;
    sortBy?: 'startTime' | 'score' | 'endTime';
    page: number;
    pageSize: number;
  }): Promise<PagedResult<DocRecord>> {
    const constraints = [];
    if (opts.examId) constraints.push(clientWhere('examId', '==', opts.examId));
    if (opts.schoolId) constraints.push(clientWhere('schoolId', '==', opts.schoolId));
    if (opts.studentId) constraints.push(clientWhere('studentId', '==', opts.studentId));
    if (opts.status) constraints.push(clientWhere('status', '==', opts.status));

    const filteredQuery = constraints.length
      ? clientQuery(clientCollection(clientDb, 'attempts'), ...constraints)
      : clientQuery(clientCollection(clientDb, 'attempts'));
    const snap = await clientGetDocs(filteredQuery);
    const attempts: DocRecord[] = snap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() }));

    const sortField = opts.sortBy || 'startTime';
    attempts.sort((a: DocRecord, b: DocRecord) => {
      const aVal = sortField === 'score' ? Number((a.data as any)?.score || 0) : new Date((a.data as any)?.[sortField] || 0).getTime();
      const bVal = sortField === 'score' ? Number((b.data as any)?.score || 0) : new Date((b.data as any)?.[sortField] || 0).getTime();
      return bVal - aVal;
    });

    return paginateInMemory(attempts, { page: opts.page, pageSize: opts.pageSize });
  }

  async update(attemptId: string, data: any): Promise<{ success: true; id: string }> {
    return enqueueWrite({ type: 'update', collectionName: 'attempts', docId: attemptId, data });
  }
}

export const attemptDao: AttemptDao = new FirestoreAttemptDao();
