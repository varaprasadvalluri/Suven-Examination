import { describe, it, expect, vi, beforeEach } from 'vitest';

// These pin the property that makes a 50,000-student exam dashboard viable: a page of ten rows
// must read ten documents, not fifty thousand.

const { getDocsMock, countMock, capturedQueries } = vi.hoisted(() => ({
  getDocsMock: vi.fn(),
  countMock: vi.fn(),
  capturedQueries: [] as any[]
}));

vi.mock('../firestoreClient', () => ({
  clientDb: { type: 'db' },
  clientDoc: vi.fn((_db: any, collectionName: string, id: string) => ({ collectionName, id })),
  clientGetDoc: vi.fn(),
  clientCollection: vi.fn((_db: any, collectionName: string) => ({ type: 'collection', collectionName })),
  clientQuery: vi.fn((collectionRef: any, ...constraints: any[]) => {
    const q = { type: 'query', collectionName: collectionRef.collectionName, constraints };
    capturedQueries.push(q);
    return q;
  }),
  clientWhere: vi.fn((field: string, op: string, value: any) => ({ type: 'where', field, op, value })),
  clientGetDocs: getDocsMock,
  clientLimit: vi.fn((value: number) => ({ type: 'limit', limit: value })),
  clientOrderBy: vi.fn((field: string, direction: string) => ({ type: 'orderBy', field, direction })),
  clientOffset: vi.fn((value: number) => ({ type: 'offset', offset: value })),
  clientGetCountFromServer: countMock
}));

vi.mock('../db/writeQueue', () => ({ enqueueWrite: vi.fn() }));

const docsFor = (n: number, startIndex = 0) => ({
  docs: Array.from({ length: n }, (_, i) => ({ id: `att_${startIndex + i}`, data: () => ({ score: i, startTime: '2026-08-01' }) }))
});

const constraintsOf = (q: any, type: string) => q.constraints.filter((c: any) => c.type === type);

beforeEach(() => {
  vi.clearAllMocks();
  capturedQueries.length = 0;
  countMock.mockResolvedValue({ data: () => ({ count: 50000 }) });
  getDocsMock.mockResolvedValue(docsFor(10));
});

describe('findByFilters — paging happens in Firestore, not in Node', () => {
  it('asks Firestore for exactly one page, not the whole result set', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByFilters({ examId: 'exam_1', page: 1, pageSize: 10 });

    // The page query is the one carrying a limit; it must ask for pageSize rows only.
    const pageQuery = capturedQueries.find((q) => constraintsOf(q, 'limit').length > 0);
    expect(constraintsOf(pageQuery, 'limit')[0].limit).toBe(10);
  });

  it('translates page number into a Firestore offset', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByFilters({ examId: 'exam_1', page: 5, pageSize: 20 });

    const pageQuery = capturedQueries.find((q) => constraintsOf(q, 'offset').length > 0);
    expect(constraintsOf(pageQuery, 'offset')[0].offset).toBe(80); // (5 - 1) * 20
  });

  it('sorts inside the query rather than in memory', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByFilters({ examId: 'exam_1', sortBy: 'score', page: 1, pageSize: 10 });

    const pageQuery = capturedQueries.find((q) => constraintsOf(q, 'orderBy').length > 0);
    expect(constraintsOf(pageQuery, 'orderBy')[0]).toMatchObject({ field: 'score', direction: 'desc' });
  });

  it('defaults to newest-first by startTime', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByFilters({ examId: 'exam_1', page: 1, pageSize: 10 });

    const pageQuery = capturedQueries.find((q) => constraintsOf(q, 'orderBy').length > 0);
    expect(constraintsOf(pageQuery, 'orderBy')[0]).toMatchObject({ field: 'startTime', direction: 'desc' });
  });

  // The count is what makes totalPages correct without reading every document.
  it('takes the total from a COUNT aggregation, not from the fetched rows', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    const result = await attemptDao.findByFilters({ examId: 'exam_1', page: 1, pageSize: 10 });

    expect(countMock).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(50000);
    expect(result.totalPages).toBe(5000);
    expect(result.items).toHaveLength(10);
  });

  it('counts against the filters only — no ordering or paging on the count query', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByFilters({ examId: 'exam_1', page: 9, pageSize: 10 });

    const countQuery = countMock.mock.calls[0][0];
    expect(constraintsOf(countQuery, 'where')).toHaveLength(1);
    expect(constraintsOf(countQuery, 'offset')).toHaveLength(0);
    expect(constraintsOf(countQuery, 'limit')).toHaveLength(0);
    expect(constraintsOf(countQuery, 'orderBy')).toHaveLength(0);
  });

  it('passes every supplied filter through as an equality constraint', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByFilters({ examId: 'e', schoolId: 's', studentId: 'u', status: 'completed', page: 1, pageSize: 10 });

    const countQuery = countMock.mock.calls[0][0];
    expect(constraintsOf(countQuery, 'where').map((c: any) => c.field).sort()).toEqual(['examId', 'schoolId', 'status', 'studentId']);
  });

  it('reports at least one page even when nothing matches', async () => {
    countMock.mockResolvedValue({ data: () => ({ count: 0 }) });
    getDocsMock.mockResolvedValue(docsFor(0));
    const { attemptDao } = await import('./FirestoreAttemptDao');

    const result = await attemptDao.findByFilters({ examId: 'exam_1', page: 1, pageSize: 10 });

    expect(result.items).toEqual([]);
    expect(result.totalPages).toBe(1);
  });
});

describe('findByFilters — fallback when the composite index is missing', () => {
  it('degrades to a capped in-memory page instead of failing the request', async () => {
    // Firestore rejects a filter+orderBy query outright when no composite index exists. A
    // school opening a dashboard must not see an error because an index was never deployed.
    getDocsMock.mockReset();
    getDocsMock
      .mockRejectedValueOnce(new Error('FAILED_PRECONDITION: The query requires an index.'))
      .mockResolvedValue(docsFor(30));
    const { attemptDao } = await import('./FirestoreAttemptDao');

    const result = await attemptDao.findByFilters({ examId: 'exam_1', page: 1, pageSize: 10 });

    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(30);
  });

  it('marks the fallback result as truncated when it hits the scan cap', async () => {
    getDocsMock.mockReset();
    getDocsMock.mockRejectedValueOnce(new Error('FAILED_PRECONDITION')).mockResolvedValue(docsFor(5000));
    const { attemptDao } = await import('./FirestoreAttemptDao');

    const result = await attemptDao.findByFilters({ examId: 'exam_1', page: 1, pageSize: 10 });

    expect(result.truncated).toBe(true);
  });

  it('caps the fallback query so the degraded path is still bounded', async () => {
    getDocsMock.mockReset();
    getDocsMock.mockRejectedValueOnce(new Error('FAILED_PRECONDITION')).mockResolvedValue(docsFor(100));
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByFilters({ examId: 'exam_1', page: 1, pageSize: 10 });

    const fallbackQuery = capturedQueries[capturedQueries.length - 1];
    expect(constraintsOf(fallbackQuery, 'limit')[0].limit).toBe(5000);
  });

  it('falls back when the COUNT aggregation itself fails', async () => {
    countMock.mockRejectedValue(new Error('aggregation unavailable'));
    getDocsMock.mockResolvedValue(docsFor(25));
    const { attemptDao } = await import('./FirestoreAttemptDao');

    const result = await attemptDao.findByFilters({ examId: 'exam_1', page: 1, pageSize: 10 });

    expect(result.total).toBe(25);
    expect(result.items).toHaveLength(10);
  });
});

describe('findByStudent — paged the same way as findByFilters', () => {
  it('asks Firestore for one page rather than the whole history', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByStudent('student_1', { page: 1, pageSize: 10 });

    const pageQuery = capturedQueries.find((q) => constraintsOf(q, 'limit').length > 0);
    expect(constraintsOf(pageQuery, 'limit')[0].limit).toBe(10);
  });

  it('translates page number into a Firestore offset', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByStudent('student_1', { page: 3, pageSize: 25 });

    const pageQuery = capturedQueries.find((q) => constraintsOf(q, 'offset').length > 0);
    expect(constraintsOf(pageQuery, 'offset')[0].offset).toBe(50); // (3 - 1) * 25
  });

  it('orders newest-first inside the query', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByStudent('student_1', { page: 1, pageSize: 10 });

    const pageQuery = capturedQueries.find((q) => constraintsOf(q, 'orderBy').length > 0);
    expect(constraintsOf(pageQuery, 'orderBy')[0]).toMatchObject({ field: 'startTime', direction: 'desc' });
  });

  it('scopes to the student, and adds status only when asked', async () => {
    const { attemptDao } = await import('./FirestoreAttemptDao');

    await attemptDao.findByStudent('student_1', { page: 1, pageSize: 10 });
    let countQuery = countMock.mock.calls[0][0];
    expect(constraintsOf(countQuery, 'where')).toEqual([{ type: 'where', field: 'studentId', op: '==', value: 'student_1' }]);

    vi.clearAllMocks();
    capturedQueries.length = 0;
    countMock.mockResolvedValue({ data: () => ({ count: 3 }) });
    getDocsMock.mockResolvedValue(docsFor(3));

    await attemptDao.findByStudent('student_1', { status: 'completed', page: 1, pageSize: 10 });
    countQuery = countMock.mock.calls[0][0];
    expect(constraintsOf(countQuery, 'where').map((c: any) => c.field).sort()).toEqual(['status', 'studentId']);
  });

  it('takes the total from the COUNT aggregation', async () => {
    countMock.mockResolvedValue({ data: () => ({ count: 42 }) });
    const { attemptDao } = await import('./FirestoreAttemptDao');

    const result = await attemptDao.findByStudent('student_1', { page: 1, pageSize: 10 });

    expect(result.total).toBe(42);
    expect(result.totalPages).toBe(5);
  });

  it('falls back to a capped in-memory page if the index is missing', async () => {
    getDocsMock.mockReset();
    getDocsMock.mockRejectedValueOnce(new Error('FAILED_PRECONDITION: The query requires an index.')).mockResolvedValue(docsFor(12));
    const { attemptDao } = await import('./FirestoreAttemptDao');

    const result = await attemptDao.findByStudent('student_1', { page: 1, pageSize: 10 });

    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(12);
  });
});
