# Suven Examination Portal

A school examination platform built to hold a single exam window: tens of thousands of students starting within the same three hours, on school networks that drop, from phones and lab desktops, where losing one submission means losing one student's exam.

`React 19` · `Express` · `Firestore` · `Cloud Run (asia-south1)` · `Capacitor (Android/iOS)`

|                      |                                                                           |
| -------------------- | ------------------------------------------------------------------------- |
| **Design capacity**  | 50,000 concurrent in-flight requests (100 instances × 500 concurrency)    |
| **Write throughput** | ~6,000 document writes per flush wave (500-doc batches × 12 concurrent)   |
| **Source**           | ~43,700 lines across `server/`, `shared/`, `src/`                         |
| **Tests**            | 202 passing across 19 files, gated in CI before any deploy                |
| **API**              | 12 route modules + 11 versioned `/api/v1` controllers, OpenAPI documented |
| **Data access**      | 23 DAO modules behind swappable interfaces                                |
| **UI**               | 46 feature components + 18 shared primitives                              |

---

## What it does

Students receive a secure exam link, prove who they are, and take a timed assessment that keeps working when their network doesn't. Staff create exams, onboard schools and candidates, watch attempts live, and export merit lists.

The whole system is built around one rule: **a submitted exam is never lost.** Every design decision below — the offline wall, the write queue, the idempotency check, the asynchronous grading — exists to serve that.

---

## The student journey

| Step               | Route                                          | What happens                                                 |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------ |
| Secure link        | `/portal/school/:schoolId/exam/:examId/:token` | Tokenised entry, no account needed                           |
| Identity check     | `/student/exam-entry`                          | `POST /api/v1/exam-entry/identity/verify`                    |
| Invitation confirm | —                                              | Lookup, then verify name / roll number / school              |
| Enrolment          | —                                              | `POST /api/v1/exam-entry/enrollments` creates the attempt    |
| Instructions       | `/exam/:attemptId`                             | Rules, duration, question count                              |
| The exam           | `/exam/:attemptId`                             | Timer, question palette, mark-for-review, autosave every 30s |
| Submission         | —                                              | `POST /api/v1/attempts/:id/submit`, scored server-side       |
| Offline fallback   | —                                              | Full-screen safe wall holds the answers locally and resyncs  |
| Result             | `/result/:attemptId`                           | Score once asynchronous grading completes                    |

Students with accounts enter through `/student/dashboard` instead, via `POST /api/v1/exam-entry/student-login`.

### UX decisions worth calling out

- **The exam screen assumes the network will fail.** Answers autosave every 30 seconds; the first tick writes `status: in-progress` and subsequent ticks stop rewriting it. On a disconnected submission, a safe wall takes over the screen, holds the answers on the device, blocks tab closure, and issues a readable receipt code the student can photograph. It resyncs automatically with bounded exponential backoff — four attempts, then it hands control to the student with a retry button, because a loop that retries forever is indistinguishable from a broken app.
- **Unanswered means unanswered.** A cleared numerical answer stores `null`, not an empty string, so the palette and the "you have unanswered questions" warning tell the truth.
- **Assets degrade, they don't dead-end.** A question diagram that fails to load retries twice on its own, then offers a button — never a permanent blank where a diagram should be.
- **Wrong answers score zero, never negative.** No penalty marking anywhere in the scoring path.

## Staff surfaces

| Screen                         | Route                                      |
| ------------------------------ | ------------------------------------------ |
| Overview                       | `/admin`                                   |
| Exam authoring                 | `/admin/exams`, `/admin/exams/create`      |
| School management & onboarding | `/admin/schools`, `/admin/schools/onboard` |
| Candidate onboarding           | `/school/candidate-onboard`                |
| Live results                   | `/admin/results/:examId`                   |
| Merit lists                    | `/admin/merit`                             |
| Proctoring                     | `/admin/proctoring`                        |
| System analytics               | `/admin/analytics`                         |
| Syllabus tracking              | `/admin/syllabus`                          |
| Cloud billing                  | `/admin/gcp-billing`                       |
| API documentation              | `/admin/api-docs`                          |

Every route is role-gated (`admin`, `school`, `student`) at the router and again at the API.

---

## Architecture

```
Browser (React 19 SPA, Capacitor shell on mobile)
   │  fetch + X-Request-Id / traceparent
   ▼
Cloud Run · suven-examination        2 vCPU · 4 GiB · concurrency 500 · max 100 instances
   │  one Node worker per vCPU (cluster)
   ├─ Express routers ──► auth middleware ──► authorization ──► controllers
   ├─ Services (AttemptSubmission, StudentDashboard)
   ├─ DAO layer (23 modules, interface-first)
   ├─ Write queue ──────────────────► Firestore REST (batched, circuit-broken)
   └─ Cloud Tasks enqueue ──► (delayed) ──► /api/v1/internal/grading-tasks ──► scoring
```

**The backend is designed to be replaceable.** Every data access goes through a DAO interface with a Firestore implementation behind it, wired in one composition root (`server/dao/index.ts`). Swapping Firestore for another database, or Express for Spring Boot, means writing new implementations — not rewriting controllers. That constraint is why the DAO layer exists at all.

### Request path

1. `requestContextMiddleware` establishes a trace id for the request, propagated implicitly through every async call.
2. `requireSession` validates the JWT session; `requireRole` gates by role.
3. `server/authorization.ts` decides tenant scope — which school's data this caller may touch.
4. Controllers call services; services call DAOs; DAOs call the Firestore REST client.
5. Writes are enqueued, not awaited against Firestore directly.

---

## Throughput and scale

### Where the capacity comes from

Cloud Run in `asia-south1` caps total requested CPU at 100 instances × 2 vCPU, so capacity comes from concurrency rather than instance count:

```
100 instances × 500 concurrent requests = 50,000 simultaneous in-flight requests
```

### The write path

Firestore's per-batch limit is 500 operations, so that is the batch size:

| Constant                 | Value    | Why                                                   |
| ------------------------ | -------- | ----------------------------------------------------- |
| `WRITE_BATCH_SIZE`       | 500      | Firestore's hard per-batch operation limit            |
| `MAX_CONCURRENT_BATCHES` | 12       | ~6,000 writes per commit round trip                   |
| `MAX_QUEUE_SIZE`         | 20,000   | Backpressure ceiling, not an unbounded buffer         |
| Flush interval           | 1,200 ms | Backstop only — enqueue also triggers a flush eagerly |

That eager trigger is not decoration. Under a **1,500-concurrent load test against real Firestore**, the plain interval fired 21 times in 3.5 minutes instead of the expected ~175, because heavy async contention starved the timer — leaving writes queued for over 100 seconds. Flushing on enqueue as well as on the timer removed that failure mode.

### Other tuned values

| Setting                     | Value                                                             |
| --------------------------- | ----------------------------------------------------------------- |
| Autosave interval           | 30 s per active attempt                                           |
| Circuit breaker             | 8 s timeout, 50% error threshold, 15 s reset                      |
| Retry policy                | 3 attempts, 100 ms base, 2 s ceiling, full jitter                 |
| Rate limit (exam entry)     | 500 requests / 15 min / IP                                        |
| Rate limit (auth bootstrap) | 100 requests / 15 min / IP                                        |
| Query cache TTLs            | 5 s invitations · 8 s exams · 15 s questions · 60 s login options |
| Answer-key cache            | 5 min                                                             |

Rate limits are per-process and deliberately generous: an entire school shares one public IP, so a limit tight enough to stop a script would block a real school's simultaneous start. Nothing in the request path depends on rate limiting for correctness — duplicate submission is made safe by an idempotency check, not by a limiter.

### Load testing

Three harnesses ship with the repo:

```bash
node load-test.cjs http://localhost:3000 20000 5 2000   # dependency-free Node simulator
k6 run k6-load-test.js                                  # ramped stages, latency thresholds
# jmeter-load-test.jmx for JMeter
```

The k6 thresholds are starting points, deliberately generous until real exam-day numbers exist: p95 enrolment under 3 s, p95 write under 2 s.

---

## Reliability

- **Idempotent submission.** A duplicate submit for an already-finished attempt is detected against Firestore and ignored, so a retried request cannot double-grade or enqueue a second grading task.
- **Asynchronous grading.** Submission enqueues a Cloud Task; a separate authenticated worker route grades it. The student's request returns in milliseconds regardless of scoring cost.
- **Circuit breakers** around every external dependency, with logged open / half-open / close transitions.
- **Liveness and readiness are separate.** Liveness checks nothing external by design — a dependency outage must never cause the orchestrator to restart a healthy fleet. Readiness reports Firestore reachability and write-queue depth.
- **Graceful shutdown.** SIGTERM starts draining, readiness turns 503, and the write queue flushes before the process exits.
- **Degraded paths are explicit.** A failed batch commit falls back to sequential writes; a missing Firestore composite index falls back to a capped in-memory page rather than failing the request.

## Security

- **The browser never talks to Firestore directly.** Every read and write goes through the server, which holds its own service-account credentials and enforces session, role, and tenant checks first. `firestore.rules` is default-deny as a backstop against a direct client call being introduced by mistake.
- **JWT sessions**, 24-hour TTL, with a startup preflight that refuses to run in production on a missing or weak secret.
- **Cloud Tasks worker routes verify an OIDC token** issued to the expected service account — the grading endpoint cannot be driven by an anonymous caller.
- **Deploys use Workload Identity Federation**, so no long-lived service-account key exists in repository secrets.
- **Load-test bypasses require a shared secret**, not just a header, so the rate-limit exemption cannot be claimed by anyone who reads the source.

## Observability

- **Structured JSON logging** — Cloud Logging parses `severity` natively and every other field becomes queryable, with no external service required.
- **OpenTelemetry tracing**, sampled by route: submissions, enrolment and grading always; autosave writes at 1%, since they are ~94% of all traffic and the least interesting. Log lines carry `logging.googleapis.com/trace`, so every log entry is one click from its trace waterfall.
- **A local trace viewer** with no Docker and no dependencies:

```bash
npm run trace:viewer                                            # terminal 1
OTEL_TRACES_ENABLED=true OTEL_EXPORTER=otlp npm start           # terminal 2
```

```
trace 6fe5c87c1121dddea758a1b3e3b774ab  12 spans · 17.6ms  1 error
POST /api/v1/exam-entry/invitations/lookup  ██████████████████  17.6ms  status=400
└ middleware - jsonParser                     ███████████        7.9ms
└ request handler - /api/v1/exam-entry/…               ███       1.7ms 
```

---

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in Firebase project config
npm run dev                    # Vite + Express on one port, http://localhost:3000
```

| Command                                     | Purpose                                      |
| ------------------------------------------- | -------------------------------------------- |
| `npm run dev`                               | Development server with HMR                  |
| `npm run build`                             | Client bundle + esbuild server bundle        |
| `npm start`                                 | Run the production bundle                    |
| `npm test`                                  | Vitest — 202 tests                           |
| `npm run test:e2e`                          | Playwright suite (targets a live deployment) |
| `npm run lint`                              | TypeScript, both client and server configs   |
| `npm run eslint` / `npm run format:check`   | Lint and formatting gates                    |
| `npm run trace:viewer`                      | Local OpenTelemetry waterfall viewer         |
| `npm run android:sync` / `npm run ios:sync` | Build and sync the Capacitor shells          |

## Deployment

Pushes to `main` run verification, and only then deploy:

```
push to main → typecheck → eslint → format → tests → build → Cloud Build → Cloud Run
```

Feature branches and pull requests are verified but never released — the deploy job is gated on `github.ref == 'refs/heads/main'` and on the verify job passing. Cloud Run settings live in `cloudbuild.yaml` alongside the reasoning for each number. See `GCP_DEPLOYMENT.md`.

## Project layout

```
server/
  auth/          session validation, JWT issuing, role gates
  dao/           23 data-access modules behind swappable interfaces
  db/            write queue, query cache
  lib/           logger, tracing context, circuit breaker, retry, scoring, task queue
  middleware/    error handling, rate limiting, Cloud Tasks OIDC verification
  routes/        12 route modules, plus 11 versioned v1 controllers
  services/      submission and dashboard orchestration
shared/          scoring and question-order logic shared by client and server
src/
  components/    46 feature components, 18 shared UI primitives
  lib/           auth context, API client, Firestore access shim
  services/      typed API wrappers
android/ ios/    Capacitor native shells
scripts/         build, signing, and the local trace viewer
```

---

Docs: `GCP_DEPLOYMENT.md` for infrastructure · `EXAM_PORTAL_REFACTOR_ARCHITECTURE.md` for the architectural history · `AUDIT_FINDINGS.md` for the standing review log.
