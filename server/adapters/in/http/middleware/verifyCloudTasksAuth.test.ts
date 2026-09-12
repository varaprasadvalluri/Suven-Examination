import { describe, it, expect, vi, beforeEach } from 'vitest';

// The property this file exists for: the audience the DISPATCHER mints must be one the
// VERIFIER accepts. It was not — the dispatcher targeted /api/v1/internal/grading-tasks while
// this middleware checked the audience against /api/internal/grade-attempt — so in any deployment
// with Cloud Tasks actually configured, every grading dispatch was rejected 401 and no attempt
// was ever graded. Nothing caught it because both sides were individually correct, and because
// local dev grades inline rather than dispatching at all.

const { verifyIdTokenMock, createTaskMock, queuePathMock } = vi.hoisted(() => ({
  verifyIdTokenMock: vi.fn(),
  createTaskMock: vi.fn().mockResolvedValue([{}]),
  queuePathMock: vi.fn(() => 'projects/proj-1/locations/us-central1/queues/exam-grading-queue')
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken: verifyIdTokenMock }))
}));

vi.mock('@google-cloud/tasks', () => ({
  CloudTasksClient: vi.fn().mockImplementation(() => ({ queuePath: queuePathMock, createTask: createTaskMock }))
}));

const CONFIG = {
  firebaseConfig: { projectId: 'proj-1', firestoreDatabaseId: '(default)', apiKey: 'k', storageBucket: '' },
  CLOUD_TASKS_LOCATION: 'us-central1',
  CLOUD_TASKS_QUEUE: 'exam-grading-queue',
  CLOUD_TASKS_INVOKER_SA: 'invoker@proj-1.iam.gserviceaccount.com',
  CLOUD_RUN_SERVICE_URL: 'https://svc.run.app',
  GRADING_WORKER_PATHS: ['/api/v1/internal/grading-tasks', '/api/internal/grade-attempt'] as const
};

vi.mock('../../../../config', () => CONFIG);

function res() {
  const sent: any = {};
  return {
    sent,
    status(code: number) {
      sent.code = code;
      return this;
    },
    json(body: any) {
      sent.body = body;
      return this;
    }
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdTokenMock.mockReset();
});

describe('verifyCloudTasksAuth', () => {
  it('accepts the exact audience the grading enqueuer actually mints', async () => {
    const { CloudTasksGradingDispatcher } = await import('../../../out/cloudtasks/CloudTasksGradingDispatcher');
    // Cloud Tasks is configured in CONFIG above, so this dispatches rather than grading
    // inline — the inline fallback is never reached and needs no real implementation.
    const dispatcher = new CloudTasksGradingDispatcher({ grade: vi.fn() } as any);
    await dispatcher.dispatch({
      eventId: 'evt_1',
      timestamp: '2026-08-21T00:00:00.000Z',
      examId: 'exam_1',
      studentId: 'student_1',
      answers: [],
      attemptId: 'att_1'
    });
    const mintedAudience = createTaskMock.mock.calls[0][0].task.httpRequest.oidcToken.audience;

    // google-auth-library throws on an audience the caller did not list, so the assertion is
    // simply: is the minted audience among the ones this middleware passes in?
    verifyIdTokenMock.mockImplementation(async ({ audience }: any) => {
      const accepted = Array.isArray(audience) ? audience : [audience];
      if (!accepted.includes(mintedAudience)) throw new Error(`Wrong recipient, payload audience != requiredAudience`);
      return { getPayload: () => ({ email: CONFIG.CLOUD_TASKS_INVOKER_SA }) };
    });

    const { verifyCloudTasksAuth } = await import('./verifyCloudTasksAuth');
    const next = vi.fn();
    const response = res();
    await verifyCloudTasksAuth({ headers: { authorization: 'Bearer oidc-token' } }, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.sent.code).toBeUndefined();
  });

  it('still accepts the legacy worker path, which the route is also mounted at', async () => {
    verifyIdTokenMock.mockImplementation(async ({ audience }: any) => {
      const accepted = Array.isArray(audience) ? audience : [audience];
      if (!accepted.includes('https://svc.run.app/api/internal/grade-attempt')) throw new Error('Wrong recipient');
      return { getPayload: () => ({ email: CONFIG.CLOUD_TASKS_INVOKER_SA }) };
    });

    const { verifyCloudTasksAuth } = await import('./verifyCloudTasksAuth');
    const next = vi.fn();
    await verifyCloudTasksAuth({ headers: { authorization: 'Bearer oidc-token' } }, res(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects a token minted for some other audience', async () => {
    verifyIdTokenMock.mockRejectedValue(new Error('Wrong recipient, payload audience != requiredAudience'));

    const { verifyCloudTasksAuth } = await import('./verifyCloudTasksAuth');
    const next = vi.fn();
    const response = res();
    await verifyCloudTasksAuth({ headers: { authorization: 'Bearer forged' } }, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.sent.code).toBe(401);
  });

  it('rejects a valid Google token issued to a different service account', async () => {
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => ({ email: 'someone-else@evil.iam.gserviceaccount.com' }) });

    const { verifyCloudTasksAuth } = await import('./verifyCloudTasksAuth');
    const next = vi.fn();
    const response = res();
    await verifyCloudTasksAuth({ headers: { authorization: 'Bearer other-sa' } }, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.sent.code).toBe(403);
  });

  it('rejects a request with no bearer token at all', async () => {
    const { verifyCloudTasksAuth } = await import('./verifyCloudTasksAuth');
    const next = vi.fn();
    const response = res();
    await verifyCloudTasksAuth({ headers: {} }, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.sent.code).toBe(401);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });
});
