// FIRST IMPORT, DELIBERATELY. The OpenTelemetry auto-instrumentations patch module exports
// as they load, so anything imported above this line produces no spans. See server/telemetry.ts.
import './server/telemetry';
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
import subjectCategoryControllerV1 from './server/routes/v1/SubjectCategoryController';
import academicLevelControllerV1 from './server/routes/v1/AcademicLevelController';
import resourceControllerV1 from './server/routes/v1/ResourceController';
import { errorHandler } from './server/middleware/errorHandler';
import { openApiSpec } from './server/swagger';
import { requireSession, requireRole } from './server/auth/middleware';
import { flushQueue, getQueueDepth } from './server/db/writeQueue';
import { beginDraining, isDraining } from './server/lib/lifecycle';
import { logger } from './server/lib/logger';
import { checkProductionConfig } from './server/lib/preflight';

let __dirname, __filename;
try {
  __filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  __dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(__filename);
} catch (_e) {
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
app.use(subjectCategoryControllerV1);
app.use(academicLevelControllerV1);

// MUST be last of the v1 routers: its '/api/v1/:resource' wildcard would otherwise shadow every
// named controller above. Express matches in registration order, so the specific routes win and
// this catches only the collections that have no dedicated controller yet.
app.use(resourceControllerV1);

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

// Cloud Run sends SIGTERM and hard-kills the container roughly 10s later, on every deploy,
// every scale-down and every instance recycle — i.e. routinely, not just on failure. Without
// this, each of those events severed in-flight requests (student-visible 502s), discarded
// whatever the in-memory write queue was still holding (up to MAX_QUEUE_SIZE = 20,000 attempt
// autosaves and submissions), and left every pending enqueueWrite promise unsettled, so its
// request hung until the 60s Cloud Run timeout and returned a 504.
//
// Order matters and is the whole point of this function:
//   1. Flip readiness to 503 FIRST, so the load balancer stops sending new requests while the
//      old ones are still being served (see server/lib/lifecycle.ts).
//   2. server.close() stops accepting new connections but lets in-flight ones finish.
//   3. Only then drain the write queue, so anything the in-flight requests enqueue on their
//      way out is included rather than raced.
const SHUTDOWN_GRACE_MS = 8000; // under Cloud Run's ~10s SIGTERM-to-SIGKILL window

function registerShutdownHandlers(server: import('http').Server) {
  const shutdown = async (signal: string) => {
    if (isDraining()) return; // a second signal must not restart the sequence
    beginDraining();
    logger.info('Shutdown initiated', { signal, pendingWrites: getQueueDepth() });

    // Hard backstop: if a wedged Firestore call stalls the drain, exit anyway rather than let
    // Cloud Run SIGKILL us at an arbitrary point. unref() so this timer alone never keeps the
    // process alive if the clean path finishes first.
    const forceExit = setTimeout(() => {
      logger.error('Shutdown grace period expired, forcing exit', { pendingWrites: getQueueDepth() });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await flushQueue();
      logger.info('Shutdown complete', { signal, pendingWrites: getQueueDepth() });
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { signal, error: err });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // asyncHandler covers route handlers, but not the code that runs outside a request: the
  // write queue's flush interval, ioredis event callbacks, the Cloud Tasks client. Under Node
  // 22 an unhandled rejection terminates the process by default — silently, and taking the
  // pending write backlog with it. Log it with the trace id, then exit through the same drain
  // path so the queue is still flushed on the way out.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { error: reason instanceof Error ? reason : new Error(String(reason)) });
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err });
    void shutdown('uncaughtException');
  });
}

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

  registerShutdownHandlers(server);

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
// There is no shared cache or lock service in this deployment — every in-memory structure
// below is per-worker. What that means, and why it is nonetheless safe:
//  - Duplicate submission: middleware/duplicateSubmission.ts's Map only catches duplicates
//    landing on the same worker. It is a cheap fast path, not the guarantee. The guarantee is
//    the idempotency re-read in services/AttemptSubmissionService.submit(), which checks the
//    attempt's own status in Firestore and so holds across every worker and instance.
//  - Rate limiting: middleware/rateLimit.ts counters are per-worker, so the effective per-IP
//    ceiling is roughly limit x workers x instances. Documented in that file; real abuse
//    protection at this scale belongs in Cloud Armor, in front of the app.
//  - Query cache (db/cache.ts): per-worker, so a write invalidates only the local copy and
//    other workers can serve a stale read for up to that collection's TTL (8-60s). Acceptable
//    because nothing correctness-critical reads through it — attempts and grading never do.
//
// Skipped entirely in dev: Vite's middlewareMode + HMR websocket don't play well with
// multiple worker processes, and local dev has no concurrency to speak of anyway.
if (process.env.NODE_ENV === 'production' && cluster.isPrimary) {
  // Run BEFORE forking any worker: a misconfiguration should stop the deploy, not surface as
  // random logouts once thousands of students are already mid-exam. Cloud Run will report the
  // revision as failed to start, which is exactly the feedback you want.
  const preflight = checkProductionConfig();
  for (const warning of preflight.warnings) {
    logger.warn('Production configuration warning', { detail: warning });
  }
  if (preflight.fatal.length > 0) {
    for (const problem of preflight.fatal) {
      logger.error('Production configuration error', { detail: problem });
    }
    console.error(`[Preflight] Refusing to start with ${preflight.fatal.length} fatal configuration problem(s) — see the errors above.`);
    process.exit(1);
  }

  let clusterShuttingDown = false;
  const numWorkers = os.cpus().length;
  console.log(`[Cluster] Primary ${process.pid} forking ${numWorkers} worker(s) (one per vCPU)...`);
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    // During shutdown, workers exiting is the expected outcome, not a crash to recover from —
    // reforking here would spawn replacements that immediately get killed by the SIGKILL that
    // follows Cloud Run's grace period.
    if (clusterShuttingDown) return;
    console.error(`[Cluster] Worker ${worker.process.pid} exited (${signal || code}). Forking a replacement.`);
    cluster.fork();
  });

  // The primary receives SIGTERM from Cloud Run, but signals sent to it are NOT automatically
  // delivered to its workers — without this the primary exits first and the workers are killed
  // mid-request with their write queues still full. Forward the signal, then wait for the
  // workers to drain and exit on their own.
  const forwardSignal = (signal: NodeJS.Signals) => {
    if (clusterShuttingDown) return;
    clusterShuttingDown = true;
    console.log(`[Cluster] Primary received ${signal}, forwarding to workers...`);
    for (const worker of Object.values(cluster.workers || {})) {
      worker?.process.kill(signal);
    }
    // Backstop slightly longer than the workers' own SHUTDOWN_GRACE_MS, so a worker that
    // drains cleanly always wins the race against this.
    setTimeout(() => process.exit(0), 9000).unref();
  };

  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));
} else {
  startServer();
}
