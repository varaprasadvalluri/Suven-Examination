import express from 'express';
import path from 'path';
import cluster from 'cluster';
import os from 'os';
import { createServer as createViteServer } from 'vite';
import './server/loadEnv';

import { fileURLToPath } from 'url';
import { PORT } from './server/config';
import healthRouter from './server/routes/health';
import cloudinaryRouter from './server/routes/cloudinary';
import firebaseStorageRouter from './server/routes/firebaseStorage';
import gatekeeperRouter from './server/routes/gatekeeper';
import dbRouter from './server/routes/db';
import authRoutesRouter from './server/routes/authRoutes';
import examsRouter from './server/routes/exams';
import gcpRouter from './server/routes/gcp';
import adminDbRouter from './server/routes/adminDb';
import reportsRouter from './server/routes/reports';
import schoolsRouter from './server/routes/schools';
import loginOptionsRouter from './server/routes/loginOptions';
import studentsRouter from './server/routes/students';
import examQuestionsRouter from './server/routes/examQuestions';
import attemptsRouter from './server/routes/attempts';
import adminStaffRouter from './server/routes/adminStaff';


let __dirname, __filename;
try {
  __filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  __dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(__filename);
} catch (e) {
  __filename = '';
  __dirname = __dirname || process.cwd();
}


const app = express();

// Default express.json() limit (100kb) is too small for a full merit-list export payload
// (thousands of student rows) — raised for that route without affecting anything else.
app.use(express.json({ limit: '2mb' }));
app.use(healthRouter);
app.use(cloudinaryRouter);
app.use(firebaseStorageRouter);
app.use(gatekeeperRouter);
app.use(dbRouter);
app.use(authRoutesRouter);
app.use(examsRouter);
app.use(gcpRouter);
app.use(adminDbRouter);
app.use(reportsRouter);
// Named, resource-specific routes — additive layer alongside the generic /api/db/query and
// /api/db/write proxy above. Not wired into the frontend yet; the generic proxy remains the
// live path for every existing screen. Same auth/authorization/sanitization logic reused from
// server/authorization.ts and server/routes/db.ts, not reimplemented.
app.use(schoolsRouter);
app.use(loginOptionsRouter);
app.use(studentsRouter);
app.use(examQuestionsRouter);
app.use(attemptsRouter);
app.use(adminStaffRouter);
app.set('trust proxy', 1);

async function startServer() {
  // Vite server middleware for local reactive dev mode
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log("Vite reactive middleware mounted successfully.");
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // SPA routing fallback
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log("Production static file directory assets distribution ready.");
  }

  // Explicit backlog — the OS default (~511 on Linux/macOS) is what a burst of thousands of
  // near-simultaneous new connections (e.g. an exam start) would queue against before this
  // process's accept() loop can drain it; connections beyond that get refused/reset instead
  // of queued. Cloud Run's own front-end load balancer buffers ahead of this in production,
  // but raising it is a cheap local backstop either way.
  app.listen(PORT, '0.0.0.0', 2048, () => {
    console.log(`[NODE EXPRESS SERVER] Server actively listening at http://localhost:${PORT}`);
  });
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
