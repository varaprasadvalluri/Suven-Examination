import { describe, it, expect, vi, beforeEach } from 'vitest';

const configState = {
  firebaseConfig: { projectId: 'proj-1', apiKey: 'key-1' },
  CLOUD_TASKS_LOCATION: 'asia-south1' as string | null,
  CLOUD_TASKS_QUEUE: 'exam-grading' as string | null,
  CLOUD_RUN_SERVICE_URL: 'https://svc.run.app' as string | null
};

vi.mock('../config', () => ({
  get firebaseConfig() {
    return configState.firebaseConfig;
  },
  get CLOUD_TASKS_LOCATION() {
    return configState.CLOUD_TASKS_LOCATION;
  },
  get CLOUD_TASKS_QUEUE() {
    return configState.CLOUD_TASKS_QUEUE;
  },
  get CLOUD_RUN_SERVICE_URL() {
    return configState.CLOUD_RUN_SERVICE_URL;
  }
}));

const fullyConfiguredEnv = { JWT_SECRET: 'a-real-secret' } as NodeJS.ProcessEnv;

beforeEach(() => {
  configState.firebaseConfig = { projectId: 'proj-1', apiKey: 'key-1' };
  configState.CLOUD_TASKS_LOCATION = 'asia-south1';
  configState.CLOUD_TASKS_QUEUE = 'exam-grading';
  configState.CLOUD_RUN_SERVICE_URL = 'https://svc.run.app';
});

describe('checkProductionConfig', () => {
  it('passes clean when everything is set', async () => {
    const { checkProductionConfig } = await import('./preflight');

    const result = checkProductionConfig(fullyConfiguredEnv);

    expect(result.fatal).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  // The one that silently breaks auth: without a shared secret each cluster worker signs with
  // its own random key, so a session minted by one worker fails on every other one.
  it('is fatal when JWT_SECRET is missing', async () => {
    const { checkProductionConfig } = await import('./preflight');

    const result = checkProductionConfig({} as NodeJS.ProcessEnv);

    expect(result.fatal).toHaveLength(1);
    expect(result.fatal[0]).toMatch(/JWT_SECRET/);
    expect(result.fatal[0]).toMatch(/logged out at random/i);
  });

  it('is fatal when Firebase credentials are missing', async () => {
    configState.firebaseConfig = { projectId: '', apiKey: '' };
    const { checkProductionConfig } = await import('./preflight');

    const result = checkProductionConfig(fullyConfiguredEnv);

    expect(result.fatal.some((f) => /FIREBASE_PROJECT_ID/.test(f))).toBe(true);
  });

  it('reports every fatal problem at once rather than stopping at the first', async () => {
    configState.firebaseConfig = { projectId: '', apiKey: '' };
    const { checkProductionConfig } = await import('./preflight');

    const result = checkProductionConfig({} as NodeJS.ProcessEnv);

    expect(result.fatal).toHaveLength(2);
  });

  // Not fatal — the app grades correctly either way — but it changes the shape of exam-end
  // load completely, so it must be visible before an exam rather than during one.
  it.each([
    [
      'CLOUD_TASKS_LOCATION',
      (): void => {
        configState.CLOUD_TASKS_LOCATION = null;
      }
    ],
    [
      'CLOUD_TASKS_QUEUE',
      (): void => {
        configState.CLOUD_TASKS_QUEUE = null;
      }
    ],
    [
      'CLOUD_RUN_SERVICE_URL',
      (): void => {
        configState.CLOUD_RUN_SERVICE_URL = null;
      }
    ]
  ])('warns (not fatal) when %s is missing, because grading falls back to inline', async (_name, unset) => {
    unset();
    const { checkProductionConfig } = await import('./preflight');

    const result = checkProductionConfig(fullyConfiguredEnv);

    expect(result.fatal).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/INLINE/);
  });
});
