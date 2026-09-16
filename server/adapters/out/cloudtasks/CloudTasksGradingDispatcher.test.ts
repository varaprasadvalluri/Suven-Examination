import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GradeAttemptService } from '../../../application/services/GradeAttemptService';

// vi.hoisted so these are safe to reference inside the (hoisted-above-imports) vi.mock
// factories below — this file reconfigures '../../../config' per describe block via
// vi.resetModules()/vi.doMock(), which those mock references need to survive.
const { queuePathMock, createTaskMock, mockGrade } = vi.hoisted(() => ({
  queuePathMock: vi.fn((project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`),
  createTaskMock: vi.fn().mockResolvedValue([{}]),
  mockGrade: vi.fn()
}));

vi.mock('@google-cloud/tasks', () => ({
  CloudTasksClient: vi.fn().mockImplementation(() => ({
    queuePath: queuePathMock,
    createTask: createTaskMock
  }))
}));

// The inline-grading fallback is injected, so the dispatcher's own behavior is testable
// without reaching the real grading use case.
const gradeInline = { grade: mockGrade } as unknown as GradeAttemptService;

function task(overrides: Record<string, any> = {}) {
  return {
    eventId: 'evt_1',
    timestamp: '2026-08-21T00:00:00.000Z',
    examId: 'exam_1',
    studentId: 'student_1',
    answers: [] as any[],
    attemptId: 'att_1',
    ...overrides
  };
}

describe('CloudTasksGradingDispatcher — Cloud Tasks not configured (local dev / this sandbox)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock('../../../config', () => ({
      firebaseConfig: { projectId: '' },
      CLOUD_TASKS_LOCATION: null,
      CLOUD_TASKS_QUEUE: null,
      CLOUD_TASKS_INVOKER_SA: null,
      CLOUD_RUN_SERVICE_URL: null,
      GRADING_WORKER_PATHS: ['/api/v1/internal/grading-tasks', '/api/internal/grade-attempt']
    }));
  });

  it('grades inline instead of dispatching a Cloud Task', async () => {
    const { CloudTasksGradingDispatcher } = await import('./CloudTasksGradingDispatcher');
    const dispatcher = new CloudTasksGradingDispatcher(gradeInline);

    await dispatcher.dispatch(task({ eventId: 'evt_3', attemptId: 'att_3' }));

    expect(mockGrade).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'att_3' }));
    expect(createTaskMock).not.toHaveBeenCalled();
  });
});

describe('CloudTasksGradingDispatcher — Cloud Tasks configured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock('../../../config', () => ({
      firebaseConfig: { projectId: 'proj-1' },
      CLOUD_TASKS_LOCATION: 'us-central1',
      CLOUD_TASKS_QUEUE: 'exam-grading-queue',
      CLOUD_TASKS_INVOKER_SA: 'invoker@proj-1.iam.gserviceaccount.com',
      CLOUD_RUN_SERVICE_URL: 'https://svc.run.app',
      // The dispatch URL and the OIDC audience both derive from this, and
      // verifyCloudTasksAuth verifies against the same list — see
      // verifyCloudTasksAuth.test.ts, which asserts the two agree.
      GRADING_WORKER_PATHS: ['/api/v1/internal/grading-tasks', '/api/internal/grade-attempt']
    }));
  });

  it('dispatches a Cloud Task with an OIDC token instead of grading inline', async () => {
    const { CloudTasksGradingDispatcher } = await import('./CloudTasksGradingDispatcher');
    const dispatcher = new CloudTasksGradingDispatcher(gradeInline);

    await dispatcher.dispatch(task({ eventId: 'evt_4', attemptId: 'att_4', answers: [{ questionId: 'q1', selectedOption: 'A' }] }));

    // Grading itself must NOT happen inline on the real-queue path — that's the whole point
    // of dispatching a task instead.
    expect(mockGrade).not.toHaveBeenCalled();
    expect(createTaskMock).toHaveBeenCalledTimes(1);

    const [{ parent, task: dispatched }] = createTaskMock.mock.calls[0];
    expect(parent).toBe('projects/proj-1/locations/us-central1/queues/exam-grading-queue');
    expect(dispatched.httpRequest.url).toBe('https://svc.run.app/api/v1/internal/grading-tasks');
    expect(dispatched.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: 'invoker@proj-1.iam.gserviceaccount.com',
      audience: 'https://svc.run.app/api/v1/internal/grading-tasks'
    });

    const decodedBody = JSON.parse(Buffer.from(dispatched.httpRequest.body, 'base64').toString('utf-8'));
    expect(decodedBody).toMatchObject({ attemptId: 'att_4', examId: 'exam_1', studentId: 'student_1' });
  });
});
