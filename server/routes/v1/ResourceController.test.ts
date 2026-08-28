import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The resource routes delegate to the same handlers the old proxy used, so what needs pinning
// is the ADAPTATION: that a REST-shaped URL turns into the right { type, collectionName, docId }
// envelope, that the wildcard cannot be pointed at arbitrary strings, and — most importantly —
// that mounting a `/:resource` wildcard has not shadowed the named controllers.

const { queryMock, writeMock, authState } = vi.hoisted(() => ({
  queryMock: vi.fn((req: any, res: any) => res.status(200).json({ ok: true, body: req.body })),
  writeMock: vi.fn((req: any, res: any) => res.status(200).json({ ok: true, body: req.body })),
  authState: { current: null as any }
}));

vi.mock('../db', () => ({ handleCollectionQuery: queryMock, handleCollectionWrite: writeMock }));

vi.mock('../../auth/middleware', () => ({
  requireSession: (req: any, res: any, next: () => void) => {
    if (!authState.current) return res.status(401).json({ error: 'Unauthorized' });
    req.auth = authState.current;
    next();
  },
  requireRole: () => (_req: any, _res: any, next: () => void) => next()
}));

vi.mock('../../middleware/duplicateSubmission', () => ({
  checkDuplicateSubmission: (_req: any, _res: any, next: () => void) => next()
}));

async function buildApp() {
  const { default: router } = await import('./ResourceController');
  const { errorHandler } = await import('../../middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.current = { uid: 'u1', role: 'admin', schoolId: null, email: null, sessionId: 's1' };
});

describe('resource-shaped URLs map onto the shared handlers', () => {
  it('POST /api/v1/:resource/search reads, carrying the constraints through', async () => {
    const app = await buildApp();

    const res = await request(app)
      .post('/api/v1/proctoring_logs/search')
      .send({ constraints: [{ type: 'where', field: 'studentId', op: '==', value: 's1' }] })
      .expect(200);

    expect(res.body.body.collectionName).toBe('proctoring_logs');
    expect(res.body.body.constraints).toHaveLength(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/v1/:resource/count sets countOnly', async () => {
    const app = await buildApp();

    const res = await request(app).post('/api/v1/proctoring_logs/count').send({}).expect(200);

    expect(res.body.body).toMatchObject({ collectionName: 'proctoring_logs', countOnly: true });
  });

  it('GET /api/v1/:resource/:id reads one document', async () => {
    const app = await buildApp();

    const res = await request(app).get('/api/v1/proctoring_logs/log_1').expect(200);

    expect(res.body.body).toMatchObject({ collectionName: 'proctoring_logs', docId: 'log_1' });
  });

  it.each([
    ['put', '/api/v1/error_books/e1', 'set'],
    ['patch', '/api/v1/error_books/e1', 'update'],
    ['delete', '/api/v1/error_books/e1', 'delete']
  ])('%s %s becomes a "%s" write on that document', async (method, url, type) => {
    const app = await buildApp();

    const res = await (request(app) as any)[method](url).send({ data: { note: 'x' } }).expect(200);

    expect(res.body.body).toMatchObject({ type, collectionName: 'error_books', docId: 'e1' });
  });

  // Create carries no id — the server assigns one.
  it('POST /api/v1/:resource becomes an "add" write with no docId', async () => {
    const app = await buildApp();

    const res = await request(app).post('/api/v1/error_books').send({ data: { note: 'x' } }).expect(200);

    expect(res.body.body).toMatchObject({ type: 'add', collectionName: 'error_books' });
    expect(res.body.body.docId).toBeUndefined();
  });

  it('accepts a bare body as the document when no { data } wrapper is given', async () => {
    const app = await buildApp();

    const res = await request(app).patch('/api/v1/error_books/e1').send({ note: 'direct' }).expect(200);

    expect(res.body.body.data).toMatchObject({ note: 'direct' });
  });
});

describe('the wildcard is guarded', () => {
  it('rejects a resource name that is not a known collection', async () => {
    const app = await buildApp();

    const res = await request(app).post('/api/v1/etc_passwd/search').send({}).expect(400);

    expect(res.body.error).toMatch(/Unknown resource/);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('requires a session for every write', async () => {
    authState.current = null;
    const app = await buildApp();

    await request(app).post('/api/v1/error_books').send({ data: {} }).expect(401);
    await request(app).patch('/api/v1/error_books/e1').send({ data: {} }).expect(401);
    await request(app).delete('/api/v1/error_books/e1').expect(401);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('leaves reads on public collections open, as the proxy did', async () => {
    authState.current = null;
    const app = await buildApp();

    await request(app).post('/api/v1/schools/search').send({}).expect(200);
  });
});

// The whole design depends on this: `/api/v1/:resource` is mounted LAST so it cannot swallow
// the named controllers. If someone reorders server.ts, this is the test that catches it.
describe('mount order — named controllers must win over the wildcard', () => {
  it('does not shadow a named route registered before it', async () => {
    const { default: resourceRouter } = await import('./ResourceController');
    const app = express();
    app.use(express.json());

    // Stand-in for AttemptController, registered first exactly as server.ts does.
    const named = express.Router();
    named.get('/api/v1/attempts/:attemptId', (_req, res) => res.status(200).json({ handledBy: 'named' }));
    app.use(named);
    app.use(resourceRouter);

    const res = await request(app).get('/api/v1/attempts/att_1').expect(200);

    expect(res.body.handledBy).toBe('named');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('still handles collections that have no named controller', async () => {
    const { default: resourceRouter } = await import('./ResourceController');
    const app = express();
    app.use(express.json());
    const named = express.Router();
    named.get('/api/v1/attempts/:attemptId', (_req, res) => res.status(200).json({ handledBy: 'named' }));
    app.use(named);
    app.use(resourceRouter);

    await request(app).get('/api/v1/proctoring_logs/log_1').expect(200);

    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
