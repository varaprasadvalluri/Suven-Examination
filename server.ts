import express from 'express';
import compression from 'compression';
import path from 'path';
import cluster from 'cluster';
import os from 'os';
import { createServer as createViteServer } from 'vite';
import './server/loadEnv';

import { fileURLToPath } from 'url';
import { PORT } from './server/config';
import { requestContextMiddleware } from './server/lib/requestContext';
import healthRouter from './server/routes/health';
import clientErrorsRouter from './server/routes/clientErrors';
import cloudinaryRouter from './server/routes/cloudinary';
import firebaseStorageRouter from './server/routes/firebaseStorage';
import gatekeeperRouter from './server/routes/gatekeeper';
import dbRouter from './server/routes/db';
import authRoutesRouter from './server/routes/authRoutes';
import examsRouter from './server/routes/exams';
import gcpRouter from './server/routes/gcp';
import adminDbRouter from './server/routes/adminDb';
import reportsRouter from './server/routes/reports';
import internalRouter from './server/routes/internal';
import schoolControllerV1 from './server/routes/v1/SchoolController';
import loginOptionsControllerV1 from './server/routes/v1/LoginOptionsController';
import studentControllerV1 from './server/routes/v1/StudentController';
import examQuestionControllerV1 from './server/routes/v1/ExamQuestionController';
import attemptControllerV1 from './server/routes/v1/AttemptController';
import adminStaffControllerV1 from './server/routes/v1/AdminStaffController';
import studentDashboardControllerV1 from './server/routes/v1/StudentDashboardController';
import { errorHandler } from './server/middleware/errorHandler';
import { openApiSpec } from './server/swagger';
import { requireSession, requireRole } from './server/auth/middleware';

let __dirname, __filename;
try {
  __filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  __dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(__filename);
} catch (e) {
  __filename = '';
  __dirname = __dirname || process.cwd();
}

const app = express();

// Gzip/brotli-negotiated response compression — the JSON payloads this API returns (question
// lists, merit-list exports, paginated attempt/exam lists) and the SPA's JS bundle both
// compress well; this cuts bytes-over-the-wire (and therefore latency) for every response
// without touching any route. Must run before routes so it can wrap their responses.
app.use(compression());

// Default express.json() limit (100kb) is too small for a full merit-list export payload
// (thousands of student rows) — raised for that route without affecting anything else.
app.use(express.json({ limit: '2mb' }));
// Must run before every router below — everything downstream (routes, DAO calls, thrown
// errors) executes inside this request's AsyncLocalStorage context, so logger.ts and
// errorHandler.ts can read the trace id without it being threaded through every call site.
app.use(requestContextMiddleware);
app.use(healthRouter);
app.use(clientErrorsRouter);
app.use(cloudinaryRouter);
app.use(firebaseStorageRouter);
app.use(gatekeeperRouter);
app.use(dbRouter);
app.use(authRoutesRouter);
app.use(examsRouter);
app.use(gcpRouter);
app.use(adminDbRouter);
app.use(reportsRouter);
// Named, resource-specific routes backed by the DAO layer (server/dao/*) — same
// auth/authorization/sanitization logic reused from server/authorization.ts, not reimplemented.
// This is the sole implementation for these 6 resources; the generic /api/db/query and
// /api/db/write proxy above remains the fallback for every other collection.
app.use(schoolControllerV1);
app.use(loginOptionsControllerV1);
app.use(studentControllerV1);
app.use(examQuestionControllerV1);
app.use(attemptControllerV1);
app.use(adminStaffControllerV1);
app.use(studentDashboardControllerV1);

// Worker route for async exam grading (server/lib/taskQueue.ts) — invoked by Cloud Tasks,
// gated by its own OIDC verification (verifyCloudTasksAuth), not requireSession.
app.use(internalRouter);

// OpenAPI spec endpoint — gated to admin sessions, same access level the client-side
// "Interactive API Docs" page (App.tsx: /admin/api-docs, roles: ['admin']) was already
// restricted to. Served as raw JSON, not a swagger-ui-express HTML page: this app's auth
// is a Bearer token attached by the SPA's fetch layer (src/lib/sessionStore.ts authHeaders),
// not a cookie, so a plain browser navigation to a server-rendered docs page could never
// carry it. The React ApiDocs page fetches this via the same authenticated fetch layer
// every other v1 API call uses, then renders it with swagger-ui-react.
app.get('/api-docs.json', requireSession, requireRole('admin'), (_req, res) => {
  res.json(openApiSpec);
});

// Centralized error handler — must be registered after every router above so next(err)
// from any of them (including asyncHandler-wrapped v1 routes) reaches it. Registered before
// Vite/static middleware is added inside startServer(), which is fine: those never call
// next(err), so ordinary (non-error) requests pass through this untouched.
app.use(errorHandler);
app.set('trust proxy', 1);

async function startServer() {
  // Vite server middleware for local reactive dev mode
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
    console.log('Vite reactive middleware mounted successfully.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Vite emits content-hashed filenames (assets/index-<hash>.js) — safe to cache those for
    // a year as immutable, since a new deploy produces new filenames rather than overwriting
    // these. `index: false` stops static from also auto-serving index.html under that same
    // long cache (it would otherwise match '/' before the SPA fallback below runs) — that
    // file must never be cached, since it's what points at the current deploy's hashed
    // assets, and the SPA fallback below sets its own no-cache header.
    app.use(express.static(distPath, { maxAge: '1y', immutable: true, index: false }));
    // SPA routing fallback
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Production static file directory assets distribution ready.');
  }

  // Explicit backlog — the OS default (~511 on Linux/macOS) is what a burst of thousands of
  // near-simultaneous new connections (e.g. an exam start) would queue against before this
  // process's accept() loop can drain it; connections beyond that get refused/reset instead
  // of queued. Cloud Run's own front-end load balancer buffers ahead of this in production,
  // but raising it is a cheap local backstop either way.
  const server = app.listen(PORT, '0.0.0.0', 2048, () => {
    console.log(`[NODE EXPRESS SERVER] Server actively listening at http://localhost:${PORT}`);
  });

  // Cloud Run's front-end load balancer keeps HTTP/1.1 keep-alive connections open longer
  // than Node's 5s default keepAliveTimeout — if this process closes a connection the LB
  // still considers open, the LB can hand a client the next request on that now-dead socket,
  // surfacing as sporadic ECONNRESET/502s under sustained load. headersTimeout must exceed
  // keepAliveTimeout (Node requirement) or the server logs a warning and ignores the setting.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

// Node.js is single-threaded — without this, only 1 of the 2 vCPUs Cloud Run allocates
// per instance (cloudbuild.yaml --cpu 2) ever actually gets used, even though Cloud Run
// bills/schedules for both. Forking one worker per vCPU lets a single instance use its
// full allocated compute under CPU-bound bursts (e.g. many students' JWTs being signed
// in the same second at exam start) instead of queuing behind one thread.
//
// Correctness requirements once this is enabled in production:
//  - REDIS_URL/REDIS_HOST must be set. server/middleware/duplicateSubmission.ts falls back
//    to an in-process Map when Redis isn't configured, which would only catch a duplicate
//    submission if it lands on the same worker twice — not a shared lock across workers.
//  - server/middleware/rateLimit.ts uses express-rate-limit's default in-memory store, which
//    is also per-process. With N workers, the effective per-IP cap is multiplied by roughly
//    N (each worker tracks its own count independently) rather than a stricter cluster
//    limit. Not a correctness break, just a wider effective ceiling — move to a shared store
//    (e.g. a Redis-backed limiter) if that matters for your abuse-prevention margins.
//
// Skipped entirely in dev: Vite's middlewareMode + HMR websocket don't play well with
// multiple worker processes, and local dev has no concurrency to speak of anyway.
if (process.env.NODE_ENV === 'production' && cluster.isPrimary) {
  const numWorkers = os.cpus().length;
  console.log(`[Cluster] Primary ${process.pid} forking ${numWorkers} worker(s) (one per vCPU)...`);
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[Cluster] Worker ${worker.process.pid} exited (${signal || code}). Forking a replacement.`);
    cluster.fork();
  });
} else {
  startServer();
}
