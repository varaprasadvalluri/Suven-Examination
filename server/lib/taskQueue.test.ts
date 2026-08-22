import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so these are safe to reference inside the (hoisted-above-imports) vi.mock
// factories below — mirrors server/authorization.test.ts's mocking approach, extended with
// vi.hoisted since this file also needs to reconfigure '../config' per describe block via
// vi.resetModules()/vi.doMock(), which those mock references need to survive.
const { mockRecompute, mockEnqueueWrite, queuePathMock, createTaskMock } = vi.hoisted(() => ({
  mockRecompute: vi.fn(),
  mockEnqueueWrite: vi.fn(),
  queuePathMock: vi.fn((project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`),
  createTaskMock: vi.fn().mockResolvedValue([{}])
}));

vi.mock('./scoreVerification', () => ({ recomputeAttemptScore: mockRecompute }));
vi.mock('../db/writeQueue', () => ({ enqueueWrite: mockEnqueueWrite }));
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
      CLOUD_RUN_SERVICE_URL: null
    }));
  });

  it('grades inline instead of dispatching a Cloud Task', async () => {
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
      CLOUD_RUN_SERVICE_URL: 'https://svc.run.app'
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
    expect(task.httpRequest.url).toBe('https://svc.run.app/api/internal/grade-attempt');
    expect(task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: 'invoker@proj-1.iam.gserviceaccount.com',
      audience: 'https://svc.run.app/api/internal/grade-attempt'
    });

    const decodedBody = JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString('utf-8'));
    expect(decodedBody).toMatchObject({ attemptId: 'att_4', examId: 'exam_1', studentId: 'student_1' });
  });
});
