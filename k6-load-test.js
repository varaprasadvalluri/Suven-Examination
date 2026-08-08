/**
 * SUVEN EDU EXAM PORTAL - k6 LOAD TEST (real backend, real Firestore)
 *
 * Unlike load-test.cjs (which uses the `x-load-test` bypass and writes to an in-memory
 * mock store on the server), this script does NOT send that header — every request goes
 * through the real /api/gatekeeper/enroll transaction and /api/db/write path, creating
 * real `users` and `attempts` documents in Firestore. Read before running:
 *
 * 1. COSTS REAL FIRESTORE QUOTA/MONEY and creates real documents. Roll numbers are
 *    prefixed "k6-loadtest-" specifically so you can find and delete them afterward
 *    (Firestore console: filter `users` and `attempts` where rollNumber/examId starts
 *    with that prefix). Nothing here cleans up after itself automatically.
 *
 * 2. Run this against a STAGING project if you have one, or during a maintenance
 *    window on production — never during a live exam, since these are real writes
 *    competing for the same Firestore capacity as real students.
 *
 * 3. The enroll endpoint is rate-limited at 20 requests / 15 min PER SOURCE IP
 *    (server/middleware/rateLimit.ts). Running this from one machine means all VUs
 *    share (roughly) one IP, so you will hit 429s well before reaching thousands of
 *    concurrent enrolls — that's the real rate limiter doing its job, not a bug in
 *    this script. To actually validate throughput at 1000+ concurrent enrolls you
 *    need either: (a) k6 Cloud / multiple distributed runners with different source
 *    IPs, or (b) temporarily raise `gatekeeperEnrollLimiter`'s limit in
 *    server/middleware/rateLimit.ts for the test window and revert after. Answer
 *    writes (/api/db/write) are NOT rate-limited the same way, so heartbeat/submit
 *    throughput past the enroll step is the more realistic thing this script measures.
 *
 * 4. Needs a real EXAM_ID + SCHOOL_ID that exist in the target Firestore already
 *    (create one via the admin dashboard first, or use an existing exam's ID from
 *    its URL in /admin/exams). Students are auto-onboarded on first enroll — you
 *    don't need to pre-create them.
 *
 * Usage:
 *   BASE_URL=https://your-service.run.app SCHOOL_ID=school-1 EXAM_ID=exam-jee-adv-1 \
 *     k6 run --vus 50 --duration 60s k6-load-test.js
 *
 *   Or with a ramp (better thundering-herd simulation of an exam start):
 *   BASE_URL=... SCHOOL_ID=... EXAM_ID=... k6 run k6-load-test.js
 *   (uses the `stages` ramp defined in `options` below by default)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SCHOOL_ID = __ENV.SCHOOL_ID || 'school-1';
const EXAM_ID = __ENV.EXAM_ID || 'exam-jee-adv-1';
const HEARTBEATS = parseInt(__ENV.HEARTBEATS || '3', 10);
const HEARTBEAT_INTERVAL_S = parseInt(__ENV.HEARTBEAT_INTERVAL_S || '4', 10);

const enrollErrors = new Counter('enroll_errors');
const writeErrors = new Counter('write_errors');
const enrollDuration = new Trend('enroll_duration', true);
const writeDuration = new Trend('write_duration', true);

export const options = {
  // Ramping stages simulate students trickling in over a couple minutes rather than
  // hitting all at once (unless you override with --vus/--duration on the CLI, which
  // takes precedence). Tune to match your real exam-start pattern.
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    // Real Firestore transaction latency, not the sub-10ms in-memory mock — verified via a
    // live 1-VU run against production Firestore: enroll ~1.3s, single write ~1.2s. These
    // thresholds are deliberately generous starting points; tighten them once you have a
    // real baseline from your own environment/region.
    enroll_duration: ['p(95)<3000'],
    write_duration: ['p(95)<2000'],
  },
};

function randomAnswers(count = 20) {
  const arr = [];
  for (let i = 0; i < count; i++) arr.push(Math.floor(Math.random() * 4));
  return arr;
}

export default function () {
  const rollNumber = `k6-loadtest-${__VU}-${__ITER}-${Date.now()}`;
  const clientFootprint = `k6-vu-${__VU}`;

  // Step 1: Enroll (real transaction: auto-onboards the student doc, creates the
  // attempt doc, mints a real session JWT — see server/routes/gatekeeper.ts).
  const enrollRes = http.post(
    `${BASE_URL}/api/gatekeeper/enroll`,
    JSON.stringify({
      rollNumber,
      finalSchoolId: SCHOOL_ID,
      finalExamId: EXAM_ID,
      examTitle: 'k6 Load Test',
      clientFootprint,
      username: `K6 LoadTest Student ${__VU}`,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  enrollDuration.add(enrollRes.timings.duration);

  const enrollOk = check(enrollRes, {
    'enroll status is 200': (r) => r.status === 200,
    'enroll returned attemptIdRaw': (r) => {
      try {
        return !!JSON.parse(r.body).attemptIdRaw;
      } catch {
        return false;
      }
    },
  });

  if (!enrollOk) {
    enrollErrors.add(1);
    return;
  }

  const { attemptIdRaw, sessionToken } = JSON.parse(enrollRes.body);
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };

  // Step 2: Periodic answer/heartbeat writes, same shape ExamInterface.tsx's 30s
  // autosave and examAnswerQueue flush send.
  for (let i = 0; i < HEARTBEATS; i++) {
    sleep(HEARTBEAT_INTERVAL_S);
    const writeRes = http.post(
      `${BASE_URL}/api/db/write`,
      JSON.stringify({
        type: 'update',
        collectionName: 'attempts',
        docId: attemptIdRaw,
        data: {
          timePerQuestion: { [i]: Math.floor(Math.random() * 30) },
          status: 'in-progress',
        },
      }),
      { headers: authHeaders }
    );
    writeDuration.add(writeRes.timings.duration);
    const ok = check(writeRes, { 'heartbeat write status is 200': (r) => r.status === 200 });
    if (!ok) writeErrors.add(1);
  }

  // Step 3: Final submit.
  const submitRes = http.post(
    `${BASE_URL}/api/db/write`,
    JSON.stringify({
      type: 'update',
      collectionName: 'attempts',
      docId: attemptIdRaw,
      data: {
        score: Math.floor(Math.random() * 80) + 20,
        accuracy: Math.floor(Math.random() * 40) + 60,
        avgTimePerCorrect: Math.floor(Math.random() * 10) + 5,
        status: 'completed',
        answers: randomAnswers(),
        endTime: new Date().toISOString(),
      },
    }),
    { headers: authHeaders }
  );
  writeDuration.add(submitRes.timings.duration);
  const submitOk = check(submitRes, { 'submit status is 200': (r) => r.status === 200 });
  if (!submitOk) writeErrors.add(1);
}
