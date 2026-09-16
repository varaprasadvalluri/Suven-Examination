import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Contract tests for the attempts API, driven through the real Express router with the DAO
// layer replaced by in-memory fakes. No Firestore, no network.
//
// This is the shape the ports were designed to make possible (application/ports/*.ts): the
// controller depends on the interface, so a test can supply any implementation of it. What is
// being tested here is specifically the logic that lives in the controller and NOT in the DAO
// — tenant scoping, the submission contract, and the guard rails — which is where regressions
// have actually landed in this codebase.

const { fakeAttemptDao, mockAuth, mockEnqueueWrite, mockEnqueueGradingTask, mockAuthorizeWrite, mockCascadeDeleteByScope } = vi.hoisted(() => ({
  fakeAttemptDao: {
    store: new Map<string, any>(),
    lastFindByFilters: null as any,
    findById: vi.fn(),
    findByFilters: vi.fn(),
    findByStudent: vi.fn(),
    submit: vi.fn(),
    update: vi.fn()
  },
  mockAuth: { current: null as any },
  mockEnqueueWrite: vi.fn().mockResolvedValue({ success: true, id: 'att_1' }),
  mockEnqueueGradingTask: vi.fn().mockResolvedValue(undefined),
  mockAuthorizeWrite: vi.fn(),
  // The reset route's bulk delete. Stubbed so the test asserts what the route ASKS for —
  // which collections, scoped by which fields — rather than exercising the paged drain
  // itself, which is the adapter's own concern.
  mockCascadeDeleteByScope: vi.fn()
}));

// requireSession normally verifies a JWT and reads users/{uid}; here it just injects whatever
// identity the test set up. The auth logic itself has its own tests (authorization.test.ts).
vi.mock('../../middleware/requireSession', () => ({
  requireSession: (req: any, res: any, next: () => void) => {
    if (!mockAuth.current) return res.status(401).json({ error: 'Unauthorized' });
    req.auth = mockAuth.current;
    next();
  },
  requireRole:
    (...roles: string[]) =>
    (req: any, res: any, next: () => void) =>
      roles.includes(req.auth?.role) ? next() : res.status(403).json({ error: 'Forbidden' })
}));

// The composition root is the single seam the controller pulls its collaborators through, so
// the whole graph is rebuilt here from fakes: a REAL AttemptSubmissionService (its submission
// contract is what these tests are about) wired to a fake DAO, a fake document store, and a
// fake grading dispatcher. Nothing about the service itself is stubbed out.
vi.mock('../../../../../composition', async () => {
  const { AuthorizationService } = await import('../../../../../application/services/authorization');
  const { AttemptSubmissionService } = await import('../../../../../application/services/AttemptSubmissionService');

  const documents = { getById: vi.fn(), write: mockEnqueueWrite };
  const grading = { dispatch: mockEnqueueGradingTask };
  const clock = { now: () => new Date('2026-08-21T00:00:00.000Z'), timestamp: () => 0 };
  // Only authorizeWrite is stubbed (it is exercised by authorization.test.ts); the pure scope
  // helpers come from the real service so the controller's tenant scoping is genuinely tested.
  const authorization = new AuthorizationService(documents);

  return {
    attemptDao: fakeAttemptDao,
    invitationDao: { setStatus: vi.fn(), create: vi.fn() },
    studentDao: { findById: vi.fn() },
    examDao: { findById: vi.fn() },
    documentStore: documents,
    cascadeDeleteByScope: mockCascadeDeleteByScope,
    authorizeWrite: mockAuthorizeWrite,
    scopeFieldFor: authorization.scopeFieldFor.bind(authorization),
    scopeValueFor: authorization.scopeValueFor.bind(authorization),
    attemptSubmissionService: new AttemptSubmissionService(
      fakeAttemptDao as any,
      documents,
      grading,
      { authorizeWrite: mockAuthorizeWrite } as any,
      clock
    )
  };
});
// The duplicate-submission lock has its own Redis/memory behaviour; here it must simply not
// block, so each test's submission reaches the controller.
vi.mock('../../middleware/duplicateSubmission', () => ({
  checkDuplicateSubmission: (_req: any, _res: any, next: () => void) => next()
}));


async function buildApp() {
  const { default: router } = await import('./AttemptController');
  const { errorHandler } = await import('../../middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use(router);
  // The real centralized error handler, mounted last exactly as server.ts does — without it a
  // thrown AppError would fall through to Express's default HTML handler and these tests would
  // assert against a different response shape than production returns.
  app.use(errorHandler);
  return app;
}

const emptyPage = { items: [] as any[], page: 1, pageSize: 10, total: 0, totalPages: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.current = null;
  fakeAttemptDao.findByFilters.mockImplementation(async (opts: any) => {
    fakeAttemptDao.lastFindByFilters = opts;
    return emptyPage;
  });
  mockAuthorizeWrite.mockImplementation(async (_auth: any, _type: string, _col: string, _id: string, data: any) => ({
    ok: true,
    data
  }));
  // Default: the attempt exists and is still in progress, so the submission path's idempotency
  // re-read lets it through. Tests that care about a finished attempt override this.
  fakeAttemptDao.findById.mockResolvedValue({ id: 'att_1', exists: true, data: { status: 'in-progress', studentId: 'student_1' } });
  mockEnqueueWrite.mockResolvedValue({ success: true, id: 'att_1' });
  mockCascadeDeleteByScope.mockResolvedValue({ deleted: 0, failed: 0 });
});

describe('GET /api/v1/attempts — tenant scoping', () => {
  it('rejects an unauthenticated caller', async () => {
    const app = await buildApp();
    await request(app).get('/api/v1/attempts').expect(401);
  });

  // The security property: a school must never be able to widen its own query to another
  // school's data by passing a different schoolId.
  it('forces a school caller to its own schoolId, ignoring the query string', async () => {
    mockAuth.current = { uid: 'u_school', role: 'school', schoolId: 'school_mine', email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).get('/api/v1/attempts?schoolId=school_someone_else').expect(200);

    expect(fakeAttemptDao.lastFindByFilters.schoolId).toBe('school_mine');
  });

  it('forces a student caller to its own studentId, ignoring the query string', async () => {
    mockAuth.current = { uid: 'student_me', role: 'student', schoolId: 'school_1', email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).get('/api/v1/attempts?studentId=student_someone_else').expect(200);

    expect(fakeAttemptDao.lastFindByFilters.studentId).toBe('student_me');
  });

  it('lets an admin query any school', async () => {
    mockAuth.current = { uid: 'u_admin', role: 'admin', schoolId: null, email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).get('/api/v1/attempts?schoolId=school_x').expect(200);

    expect(fakeAttemptDao.lastFindByFilters.schoolId).toBe('school_x');
  });

  it('ignores an unknown sortBy rather than passing it through to the DAO', async () => {
    mockAuth.current = { uid: 'u_admin', role: 'admin', schoolId: null, email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).get('/api/v1/attempts?sortBy=; DROP TABLE').expect(200);

    expect(fakeAttemptDao.lastFindByFilters.sortBy).toBeUndefined();
  });

  it('caps pageSize at the documented maximum', async () => {
    mockAuth.current = { uid: 'u_admin', role: 'admin', schoolId: null, email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).get('/api/v1/attempts?pageSize=100000').expect(200);

    expect(fakeAttemptDao.lastFindByFilters.pageSize).toBe(200);
  });
});

describe('GET /api/v1/attempts/:attemptId — cross-tenant reads', () => {
  it("hides another school's attempt behind exists:false rather than a 403", async () => {
    mockAuth.current = { uid: 'u_school', role: 'school', schoolId: 'school_mine', email: null, sessionId: 's1' };
    fakeAttemptDao.findById.mockResolvedValue({
      id: 'att_other',
      exists: true,
      data: { schoolId: 'school_other', status: 'completed' }
    });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/attempts/att_other').expect(200);

    // A 403 would confirm the attempt ID exists; exists:false does not.
    expect(res.body.data).toEqual({ id: 'att_other', exists: false });
  });

  it("returns the attempt when it belongs to the caller's own school", async () => {
    mockAuth.current = { uid: 'u_school', role: 'school', schoolId: 'school_mine', email: null, sessionId: 's1' };
    fakeAttemptDao.findById.mockResolvedValue({
      id: 'att_mine',
      exists: true,
      data: { schoolId: 'school_mine', status: 'completed', score: 7 }
    });
    const app = await buildApp();

    const res = await request(app).get('/api/v1/attempts/att_mine').expect(200);

    expect(res.body.data.exists).toBe(true);
    expect(res.body.data.data.score).toBe(7);
  });
});

describe('POST /api/v1/attempts/:attemptId/submit', () => {
  const studentAuth = { uid: 'student_1', role: 'student', schoolId: 'school_1', email: null as string | null, sessionId: 's1' };

  it('never persists a client-supplied score or accuracy', async () => {
    mockAuth.current = studentAuth;
    const app = await buildApp();

    await request(app)
      .post('/api/v1/attempts/att_1/submit')
      .send({ answers: [0, 1, 2], score: 999999, accuracy: 100 })
      .expect(200);

    const written = mockEnqueueWrite.mock.calls[0][0].data;
    expect(written.score).toBeUndefined();
    expect(written.accuracy).toBeUndefined();
    expect(written.answers).toEqual([0, 1, 2]);
  });

  // The state machine both submission paths now share: answers land immediately as
  // 'submitted', and grading flips it to 'completed' afterwards.
  it("persists status='submitted' and queues grading rather than grading inline", async () => {
    mockAuth.current = studentAuth;
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/attempts/att_1/submit')
      .send({ answers: [1] })
      .expect(200);

    expect(mockEnqueueWrite.mock.calls[0][0].data.status).toBe('submitted');
    expect(mockEnqueueGradingTask).toHaveBeenCalledTimes(1);
    expect(mockEnqueueGradingTask.mock.calls[0][0]).toMatchObject({ attemptId: 'att_1', studentId: 'student_1' });
    expect(res.body).toMatchObject({ success: true, id: 'att_1', queued: true });
  });

  it('surfaces an authorization denial as its own status code and writes nothing', async () => {
    mockAuth.current = studentAuth;
    mockAuthorizeWrite.mockResolvedValue({ ok: false, status: 403, error: 'You do not own this document' });
    const app = await buildApp();

    await request(app).post('/api/v1/attempts/att_other/submit').send({ answers: [] }).expect(403);

    expect(mockEnqueueWrite).not.toHaveBeenCalled();
    expect(mockEnqueueGradingTask).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated submission', async () => {
    const app = await buildApp();
    await request(app).post('/api/v1/attempts/att_1/submit').send({ answers: [] }).expect(401);
    expect(mockEnqueueWrite).not.toHaveBeenCalled();
  });

  // IDEMPOTENCY. There is no shared lock in this deployment, so a duplicate submission that
  // lands on a different worker or instance reaches the service with the in-process lock
  // never having seen it. The re-read below is what stops it, and these tests pin that.
  describe('duplicate submissions (no shared lock — Firestore is the source of truth)', () => {
    it.each(['submitted', 'completed', 'grading_failed'])(
      'does not re-write or re-queue an attempt already in %s',
      async (existingStatus) => {
        mockAuth.current = studentAuth;
        fakeAttemptDao.findById.mockResolvedValue({
          id: 'att_1',
          exists: true,
          data: { status: existingStatus, studentId: 'student_1', answers: [1, 2, 3] }
        });
        const app = await buildApp();

        const res = await request(app)
          .post('/api/v1/attempts/att_1/submit')
          .send({ answers: [9, 9, 9] })
          .expect(200);

        // Answers already accepted must not be overwritten by the late duplicate.
        expect(mockEnqueueWrite).not.toHaveBeenCalled();
        // A second grading task for the same attempt would be wasted work at best.
        expect(mockEnqueueGradingTask).not.toHaveBeenCalled();
        // Reported as success: the student's exam IS submitted. Erroring here would be wrong
        // if it was the FIRST request's response that got lost.
        expect(res.body).toMatchObject({ success: true, id: 'att_1', duplicate: true });
      }
    );

    it('still accepts a submission for an attempt that is only in-progress', async () => {
      mockAuth.current = studentAuth;
      fakeAttemptDao.findById.mockResolvedValue({
        id: 'att_1',
        exists: true,
        data: { status: 'in-progress', studentId: 'student_1' }
      });
      const app = await buildApp();

      const res = await request(app)
        .post('/api/v1/attempts/att_1/submit')
        .send({ answers: [1] })
        .expect(200);

      expect(mockEnqueueWrite).toHaveBeenCalledTimes(1);
      expect(mockEnqueueGradingTask).toHaveBeenCalledTimes(1);
      expect(res.body.duplicate).toBeUndefined();
    });

    it('accepts a submission for an attempt that has expired rather than finished', async () => {
      mockAuth.current = studentAuth;
      fakeAttemptDao.findById.mockResolvedValue({
        id: 'att_1',
        exists: true,
        data: { status: 'expired', studentId: 'student_1' }
      });
      const app = await buildApp();

      await request(app)
        .post('/api/v1/attempts/att_1/submit')
        .send({ answers: [1] })
        .expect(200);

      expect(mockEnqueueWrite).toHaveBeenCalledTimes(1);
    });

    // Two requests racing on the same worker: the middleware's in-process lock is the cheap
    // fast path that rejects the second before it costs a Firestore read.
    it('rejects a same-worker double-tap at the middleware with 429', async () => {
      vi.resetModules();
      vi.doMock('../../middleware/duplicateSubmission', async () => {
        const actual = await vi.importActual<any>('../../middleware/duplicateSubmission');
        return actual;
      });
      const { default: router } = await import('./AttemptController');
      const { errorHandler } = await import('../../middleware/errorHandler');
      const { __resetSubmissionLocks } = await import('../../middleware/duplicateSubmission');
      __resetSubmissionLocks();

      mockAuth.current = studentAuth;
      const app = express();
      app.use(express.json());
      app.use(router);
      app.use(errorHandler);

      await request(app)
        .post('/api/v1/attempts/att_race/submit')
        .send({ answers: [1] })
        .expect(200);
      const second = await request(app)
        .post('/api/v1/attempts/att_race/submit')
        .send({ answers: [1] });

      expect(second.status).toBe(429);
      expect(second.body.code).toBe('DUPLICATE_SUBMISSION');
    });
  });
});

describe('PATCH /api/v1/attempts/:attemptId', () => {
  it('refuses to complete an attempt, directing the caller to the submit route', async () => {
    mockAuth.current = { uid: 'student_1', role: 'student', schoolId: 'school_1', email: null, sessionId: 's1' };
    const app = await buildApp();

    const res = await request(app).patch('/api/v1/attempts/att_1').send({ status: 'completed' }).expect(400);

    expect(res.body.error).toMatch(/submit/i);
    expect(fakeAttemptDao.update).not.toHaveBeenCalled();
  });

  it('allows an ordinary autosave through to the DAO', async () => {
    mockAuth.current = { uid: 'student_1', role: 'student', schoolId: 'school_1', email: null, sessionId: 's1' };
    fakeAttemptDao.update.mockResolvedValue({ success: true, id: 'att_1' });
    const app = await buildApp();

    await request(app)
      .patch('/api/v1/attempts/att_1')
      .send({ answers: [1, 2] })
      .expect(200);

    expect(fakeAttemptDao.update).toHaveBeenCalledWith('att_1', expect.objectContaining({ answers: [1, 2] }));
  });
});

// ============================================================================
// DELETE /api/v1/attempts/:attemptId/reset
// ============================================================================
// Exists because AdminResults.tsx could not do this from the client any more: error_books
// carry no schoolId, so a school-role read of them cannot be tenant-scoped and is no longer
// granted at all. The client sequence deleted the attempt first and the dependents after, so a
// school user got the attempt and its proctoring logs deleted, a 403 on the error-book step,
// and a "reset failed" toast for an operation that had already half-run.
describe('DELETE /api/v1/attempts/:attemptId/reset', () => {
  const ownAttempt = { id: 'att_1', exists: true, data: { status: 'completed', studentId: 'student_1', examId: 'exam_1', schoolId: 'school_mine' } };

  it('rejects a student, who may never reset an attempt', async () => {
    mockAuth.current = { uid: 'student_1', role: 'student', schoolId: 'school_mine', email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).delete('/api/v1/attempts/att_1/reset').expect(403);
    expect(mockEnqueueWrite).not.toHaveBeenCalled();
  });

  it("rejects a school resetting another school's attempt", async () => {
    fakeAttemptDao.findById.mockResolvedValue(ownAttempt);
    mockAuth.current = { uid: 'u_school', role: 'school', schoolId: 'school_someone_else', email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).delete('/api/v1/attempts/att_1/reset').expect(403);
    expect(mockCascadeDeleteByScope).not.toHaveBeenCalled();
    expect(mockEnqueueWrite).not.toHaveBeenCalled();
  });

  it('clears dependents scoped by student AND exam, then the attempt itself', async () => {
    fakeAttemptDao.findById.mockResolvedValue(ownAttempt);
    mockAuth.current = { uid: 'u_school', role: 'school', schoolId: 'school_mine', email: null, sessionId: 's1' };
    const app = await buildApp();

    const res = await request(app).delete('/api/v1/attempts/att_1/reset').expect(200);

    // studentId + examId, not attemptId: logProctorAnomaly writes an attemptId onto its logs
    // but logActivity does not, so scoping by attempt id — as the client-side version did —
    // silently leaves every logActivity entry behind. error_books never carry one at all.
    for (const collectionName of ['proctoring_logs', 'error_books']) {
      expect(mockCascadeDeleteByScope).toHaveBeenCalledWith(collectionName, 'studentId', 'student_1', { field: 'examId', value: 'exam_1' });
    }
    expect(mockEnqueueWrite).toHaveBeenCalledWith({ type: 'delete', collectionName: 'attempts', docId: 'att_1' });
    expect(res.body).toMatchObject({ success: true, attemptDeleted: true });
  });

  it('leaves the attempt in place when a dependent collection could not be fully cleared', async () => {
    // The ordering property. A half-cleared reset that still has its attempt doc is
    // recoverable — the school retries. One where the attempt is gone and its records are not
    // leaves rows no query will ever reach again.
    fakeAttemptDao.findById.mockResolvedValue(ownAttempt);
    mockCascadeDeleteByScope.mockResolvedValue({ deleted: 3, failed: 1 });
    mockAuth.current = { uid: 'u_admin', role: 'admin', schoolId: null, email: null, sessionId: 's1' };
    const app = await buildApp();

    const res = await request(app).delete('/api/v1/attempts/att_1/reset').expect(200);

    expect(mockEnqueueWrite).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ success: false, attemptDeleted: false });
  });

  it('does not delete on a half key when the attempt is missing a studentId or examId', async () => {
    // Scoping by studentId alone would take out that student's error book for EVERY exam.
    fakeAttemptDao.findById.mockResolvedValue({ id: 'att_1', exists: true, data: { status: 'completed', schoolId: 'school_mine' } });
    mockAuth.current = { uid: 'u_admin', role: 'admin', schoolId: null, email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).delete('/api/v1/attempts/att_1/reset').expect(200);

    expect(mockCascadeDeleteByScope).not.toHaveBeenCalled();
    expect(mockEnqueueWrite).toHaveBeenCalledWith({ type: 'delete', collectionName: 'attempts', docId: 'att_1' });
  });

  it('404s on an attempt that does not exist', async () => {
    fakeAttemptDao.findById.mockResolvedValue({ id: 'att_missing', exists: false, data: null });
    mockAuth.current = { uid: 'u_admin', role: 'admin', schoolId: null, email: null, sessionId: 's1' };
    const app = await buildApp();

    await request(app).delete('/api/v1/attempts/att_missing/reset').expect(404);
  });
});
