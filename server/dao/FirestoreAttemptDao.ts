import {
  clientDb,
  clientDoc,
  clientGetDoc,
  clientCollection,
  clientQuery,
  clientWhere,
  clientGetDocs,
  clientLimit,
  clientOrderBy,
  clientOffset,
  clientGetCountFromServer
} from '../firestoreClient';
import { enqueueWrite } from '../db/writeQueue';
import { SingleDocResult, DocRecord } from './SchoolDao';
import { AttemptDao } from './AttemptDao';
import { PagedResult, paginateInMemory } from './pagination';
import { logger } from '../lib/logger';

type AttemptSortField = 'startTime' | 'score' | 'endTime';

// Ceiling on how many documents the DEGRADED path may read (see pagedQueryInMemory). The fast
// path never reads more than one page, so this only bounds the fallback — chosen so that even
// with a missing index a single request costs thousands of reads rather than tens of thousands,
// and the parsed response stays in the low tens of MB on a 4Gi instance.
const MAX_ATTEMPT_SCAN = 5000;

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

  // SERVER-SIDE (database-side) PAGINATION — shared by both list methods below.
  //
  // Firestore does the ordering and the slicing and returns only the rows for the requested
  // page; the total comes from a COUNT aggregation rather than from counting fetched documents.
  // A ten-row page transfers ten documents instead of the whole result set.
  //
  // Honest about offset: Firestore bills the documents that `offset` skips, so page 100 costs
  // proportionally more to read than page 1. Offset was chosen anyway because it preserves the
  // page-number contract the existing UI is built on. Cursor pagination (startAfter) is the only
  // shape with flat cost, and it cannot express "jump to page 40" — worth moving to if deep
  // paging becomes a real access pattern rather than a theoretical one.
  //
  // Ordering inside the query means a composite index is required for each filter+sort
  // combination (see firestore.indexes.json). Firestore FAILS such a query when the index is
  // missing rather than answering slowly, so this falls back to a capped in-memory page instead
  // of surfacing an error to a student or a school mid-exam — degraded, logged, still correct.
  private async pagedQuery(
    constraints: any[],
    sortField: AttemptSortField,
    opts: { page: number; pageSize: number },
    logContext: Record<string, unknown>
  ): Promise<PagedResult<DocRecord>> {
    try {
      // Counted against the filters alone — no ordering, no paging — so it stays a single cheap
      // scalar regardless of which page is being viewed.
      const countSnap = await clientGetCountFromServer(clientQuery(clientCollection(clientDb, 'attempts'), ...constraints));
      const total = countSnap.data().count;

      const pageQuery = clientQuery(
        clientCollection(clientDb, 'attempts'),
        ...constraints,
        clientOrderBy(sortField, 'desc'),
        clientOffset((opts.page - 1) * opts.pageSize),
        clientLimit(opts.pageSize)
      );
      const snap = await clientGetDocs(pageQuery);
      const items: DocRecord[] = snap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() }));

      return {
        items,
        page: opts.page,
        pageSize: opts.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / opts.pageSize))
      };
    } catch (err) {
      logger.warn('Paged attempt query failed, falling back to a capped in-memory page', {
        ...logContext,
        sortBy: sortField,
        cap: MAX_ATTEMPT_SCAN,
        hint: 'A missing composite index is the usual cause — deploy firestore.indexes.json.',
        error: err
      });
      return this.pagedQueryInMemory(constraints, sortField, opts);
    }
  }

  // The pre-server-side-pagination implementation, kept only as the fallback above. Capped so
  // that even in the degraded case a single request cannot read an unbounded number of documents.
  private async pagedQueryInMemory(
    constraints: any[],
    sortField: AttemptSortField,
    opts: { page: number; pageSize: number }
  ): Promise<PagedResult<DocRecord>> {
    const filteredQuery = clientQuery(clientCollection(clientDb, 'attempts'), ...constraints, clientLimit(MAX_ATTEMPT_SCAN));
    const snap = await clientGetDocs(filteredQuery);
    const attempts: DocRecord[] = snap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() }));

    attempts.sort((a: DocRecord, b: DocRecord) => {
      const aVal = sortField === 'score' ? Number((a.data as any)?.score || 0) : new Date((a.data as any)?.[sortField] || 0).getTime();
      const bVal = sortField === 'score' ? Number((b.data as any)?.score || 0) : new Date((b.data as any)?.[sortField] || 0).getTime();
      return bVal - aVal;
    });

    return {
      ...paginateInMemory(attempts, { page: opts.page, pageSize: opts.pageSize }),
      truncated: attempts.length >= MAX_ATTEMPT_SCAN
    };
  }

  // A single student's history is small — bounded by the exams they have actually sat — which is
  // why this was left fetching everything and slicing in memory when findByFilters moved to
  // database-side paging. It is paged the same way now regardless: two methods answering the
  // same shape of question with different cost models is the kind of inconsistency that quietly
  // becomes wrong later, and the indexes it needs (studentId + startTime, studentId + status +
  // startTime) were already declared for the other query anyway.
  async findByStudent(studentId: string, opts: { status?: string; page: number; pageSize: number }): Promise<PagedResult<DocRecord>> {
    const constraints = [clientWhere('studentId', '==', studentId)];
    if (opts.status) constraints.push(clientWhere('status', '==', opts.status));

    return this.pagedQuery(constraints, 'startTime', opts, { studentId, status: opts.status });
  }

  // General-purpose list backing GET /api/v1/attempts. All filters optional and AND-combined.
  async findByFilters(opts: {
    examId?: string;
    schoolId?: string;
    studentId?: string;
    status?: string;
    sortBy?: AttemptSortField;
    page: number;
    pageSize: number;
  }): Promise<PagedResult<DocRecord>> {
    const constraints = [];
    if (opts.examId) constraints.push(clientWhere('examId', '==', opts.examId));
    if (opts.schoolId) constraints.push(clientWhere('schoolId', '==', opts.schoolId));
    if (opts.studentId) constraints.push(clientWhere('studentId', '==', opts.studentId));
    if (opts.status) constraints.push(clientWhere('status', '==', opts.status));

    return this.pagedQuery(constraints, opts.sortBy || 'startTime', opts, {
      examId: opts.examId,
      schoolId: opts.schoolId,
      studentId: opts.studentId,
      status: opts.status
    });
  }

  async update(attemptId: string, data: any): Promise<{ success: true; id: string }> {
    return enqueueWrite({ type: 'update', collectionName: 'attempts', docId: attemptId, data });
  }
}

export const attemptDao: AttemptDao = new FirestoreAttemptDao();
