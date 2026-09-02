import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so these are safe to reference inside the (hoisted-above-imports) vi.mock
// factories below — mirrors server/authorization.test.ts's mocking approach, extended with
// vi.hoisted since this file also needs to reconfigure '../config' per describe block via
// vi.resetModules()/vi.doMock(), which those mock references need to survive.
const { mockRecompute, mockEnqueueWrite, queuePathMock, createTaskMock, mockGetDoc } = vi.hoisted(() => ({
  mockRecompute: vi.fn(),
  mockEnqueueWrite: vi.fn(),
  queuePathMock: vi.fn((project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`),
  createTaskMock: vi.fn().mockResolvedValue([{}]),
  mockGetDoc: vi.fn()
}));

// gradeAttempt re-reads the attempt before writing a grade, so this must be mocked. Helper
// below sets what that read returns for a given test.
const attemptInStatus = (status: string | null) =>
  mockGetDoc.mockResolvedValue({ exists: () => status !== null, data: () => (status === null ? null : { status }) });

vi.mock('./scoreVerification', () => ({ recomputeAttemptScore: mockRecompute }));
vi.mock('../db/writeQueue', () => ({ enqueueWrite: mockEnqueueWrite }));
vi.mock('../firestoreClient', () => ({
  clientDb: { type: 'db' },
  clientDoc: vi.fn((_db: any, collectionName: string, id: string) => ({ type: 'doc', collectionName, id })),
  clientGetDoc: mockGetDoc
}));
vi.mock('@google-cloud/tasks', () => ({
  CloudTasksClient: vi.fn().mockImplementation(() => ({
    queuePath: queuePathMock,
    createTask: createTaskMock
  }))
}));

describe('TaskQueueService.gradeAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recomputes the score and writes status=completed via the existing write-batcher', async () => {
    attemptInStatus('submitted');
    mockRecompute.mockResolvedValue({ score: 8, accuracy: 80 });
    const { taskQueueService } = await import('./taskQueue');

    await taskQueueService.gradeAttempt({
      eventId: 'evt_1',
      timestamp: '2026-08-21T00:00:00.000Z',
      examId: 'exam_1',
      studentId: 'student_1',
      answers: [{ questionId: 'q1', selectedOption: 'B' }],
      attemptId: 'att_1'
    });

    expect(mockRecompute).toHaveBeenCalledWith('att_1', [{ questionId: 'q1', selectedOption: 'B' }]);
    expect(mockEnqueueWrite).toHaveBeenCalledWith({
      type: 'update',
      collectionName: 'attempts',
      docId: 'att_1',
      data: { status: 'completed', score: 8, accuracy: 80 }
    });
  });

  it('propagates a recompute failure without writing anything', async () => {
    attemptInStatus('submitted');
    mockRecompute.mockRejectedValue(new Error('attempt does not exist'));
    const { taskQueueService } = await import('./taskQueue');

    await expect(
      taskQueueService.gradeAttempt({
        eventId: 'evt_2',
        timestamp: '2026-08-21T00:00:00.000Z',
        examId: 'exam_1',
        studentId: 'student_1',
        answers: [],
        attemptId: 'missing_attempt'
      })
    ).rejects.toThrow('attempt does not exist');
    expect(mockEnqueueWrite).not.toHaveBeenCalled();
  });

  // A school re-triggering an attempt during the grading window resets it to 'started' with
  // empty answers. Writing the old grade over that would resurrect a stale score on an attempt
  // the student is actively retaking.
  it.each(['started', 'in-progress', 'completed', 'expired'])('skips grading when the attempt has moved to %s', async (currentStatus) => {
    attemptInStatus(currentStatus);
    const { taskQueueService } = await import('./taskQueue');

    await taskQueueService.gradeAttempt({
      eventId: 'evt_guard',
      timestamp: '2026-08-21T00:00:00.000Z',
      examId: 'exam_1',
      studentId: 'student_1',
      answers: [],
      attemptId: 'att_guard'
    });

    expect(mockRecompute).not.toHaveBeenCalled();
    expect(mockEnqueueWrite).not.toHaveBeenCalled();
  });

  // Cloud Tasks delivers at least once, so a redelivered task must be a no-op rather than a
  // second write.
  it('is idempotent: a redelivered task for an already-graded attempt writes nothing', async () => {
    attemptInStatus('completed');
    const { taskQueueService } = await import('./taskQueue');

    await taskQueueService.gradeAttempt({
      eventId: 'evt_dup',
      timestamp: '2026-08-21T00:00:00.000Z',
      examId: 'exam_1',
      studentId: 'student_1',
      answers: [],
      attemptId: 'att_dup'
    });

    expect(mockEnqueueWrite).not.toHaveBeenCalled();
  });

  it('skips grading when the attempt no longer exists', async () => {
    attemptInStatus(null);
    const { taskQueueService } = await import('./taskQueue');

    await taskQueueService.gradeAttempt({
      eventId: 'evt_gone',
      timestamp: '2026-08-21T00:00:00.000Z',
      examId: 'exam_1',
      studentId: 'student_1',
      answers: [],
      attemptId: 'att_gone'
    });

    expect(mockRecompute).not.toHaveBeenCalled();
    expect(mockEnqueueWrite).not.toHaveBeenCalled();
  });
});

describe('TaskQueueService.enqueueGradingTask — Cloud Tasks not configured (local dev / this sandbox)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock('../config', () => ({
      firebaseConfig: { projectId: '' },
      CLOUD_TASKS_LOCATION: null,
      CLOUD_TASKS_QUEUE: null,
      CLOUD_TASKS_INVOKER_SA: null,
      CLOUD_RUN_SERVICE_URL: null,
      GRADING_WORKER_PATHS: ['/api/v1/internal/grading-tasks', '/api/internal/grade-attempt']
    }));
  });

  it('grades inline instead of dispatching a Cloud Task', async () => {
    attemptInStatus('submitted');
    mockRecompute.mockResolvedValue({ score: 5, accuracy: 50 });
    const { taskQueueService } = await import('./taskQueue');

    await taskQueueService.enqueueGradingTask({
      eventId: 'evt_3',
      timestamp: '2026-08-21T00:00:00.000Z',
      examId: 'exam_1',
      studentId: 'student_1',
      answers: [],
      attemptId: 'att_3'
    });

    expect(mockRecompute).toHaveBeenCalledWith('att_3', []);
    expect(mockEnqueueWrite).toHaveBeenCalledWith(
      expect.objectContaining({ docId: 'att_3', data: expect.objectContaining({ status: 'completed' }) })
    );
    expect(createTaskMock).not.toHaveBeenCalled();
  });
});

describe('TaskQueueService.enqueueGradingTask — Cloud Tasks configured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock('../config', () => ({
      firebaseConfig: { projectId: 'proj-1' },
      CLOUD_TASKS_LOCATION: 'us-central1',
      CLOUD_TASKS_QUEUE: 'exam-grading-queue',
      CLOUD_TASKS_INVOKER_SA: 'invoker@proj-1.iam.gserviceaccount.com',
      CLOUD_RUN_SERVICE_URL: 'https://svc.run.app',
      // The dispatch URL and the OIDC audience both derive from this, and
      // verifyCloudTasksAuth verifies against the same list — see
      // server/middleware/verifyCloudTasksAuth.test.ts, which asserts the two agree.
      GRADING_WORKER_PATHS: ['/api/v1/internal/grading-tasks', '/api/internal/grade-attempt']
    }));
  });

  it('dispatches a Cloud Task with an OIDC token instead of grading inline', async () => {
    const { taskQueueService } = await import('./taskQueue');

    await taskQueueService.enqueueGradingTask({
      eventId: 'evt_4',
      timestamp: '2026-08-21T00:00:00.000Z',
      examId: 'exam_1',
      studentId: 'student_1',
      answers: [{ questionId: 'q1', selectedOption: 'A' }],
      attemptId: 'att_4'
    });

    // Grading itself must NOT happen inline on the real-queue path — that's the whole point
    // of dispatching a task instead.
    expect(mockRecompute).not.toHaveBeenCalled();
    expect(createTaskMock).toHaveBeenCalledTimes(1);

    const [{ parent, task }] = createTaskMock.mock.calls[0];
    expect(parent).toBe('projects/proj-1/locations/us-central1/queues/exam-grading-queue');
    expect(task.httpRequest.url).toBe('https://svc.run.app/api/v1/internal/grading-tasks');
    expect(task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: 'invoker@proj-1.iam.gserviceaccount.com',
      audience: 'https://svc.run.app/api/v1/internal/grading-tasks'
    });

    const decodedBody = JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString('utf-8'));
    expect(decodedBody).toMatchObject({ attemptId: 'att_4', examId: 'exam_1', studentId: 'student_1' });
  });
});
