/**
 * 🚀 SUVEN EDU EXAM PORTAL - HIGH-CONCURRENCY LOAD TEST SIMULATOR
 * 
 * This script simulates thousands of concurrent students taking an exam on the SuvenEdu platform.
 * It is built using pure Node.js (no external npm dependencies) so you can run it anywhere
 * instantly by running:
 * 
 *    node load-test.js [target_url] [number_of_students]
 * 
 * Example:
 *    node load-test.js http://localhost:3000 500
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Parse command-line arguments
const targetArg = process.argv[2] || 'http://localhost:3000';
const studentsArg = parseInt(process.argv[3], 10) || 100;
const durationArg = parseInt(process.argv[4], 10) || 10; // in seconds

// Configuration
const CONFIG = {
  targetUrl: targetArg.replace(/\/$/, ''), // Remove trailing slash
  totalStudents: studentsArg,
  testDurationSeconds: durationArg,
  rampUpMs: 2000, // Ramp-up window to stagger initial connections
  heartbeatIntervalMs: 3000, // Simulated proctor heartbeat interval
  concurrencyLimit: 50, // Max simultaneous HTTP requests in flight
};

// State metrics tracker
const METRICS = {
  startTime: 0,
  endTime: 0,
  requestsSent: 0,
  requestsSuccess: 0,
  requestsFailed: 0,
  latencies: [],
  endpoints: {
    health: { sent: 0, success: 0, failed: 0 },
    enroll: { sent: 0, success: 0, failed: 0 },
    heartbeat: { sent: 0, success: 0, failed: 0 },
    submit: { sent: 0, success: 0, failed: 0 }
  },
  errors: {}
};

// Keep track of active requests to honor concurrency limits
let activeRequestsCount = 0;
const requestQueue = [];

console.log(`
===================================================================
⚡ SUVEN EDU EXAM PORTAL - HIGH-CONCURRENCY LOAD TESTING SIMULATOR
===================================================================
🎯 Target Host:       ${CONFIG.targetUrl}
👥 Simulated Users:   ${CONFIG.totalStudents} concurrent students
⏱️ Test Duration:     ${CONFIG.testDurationSeconds} seconds
🛡️ Concurrency Limit: ${CONFIG.concurrencyLimit} simultaneous connections
===================================================================
`);

// Helper to make custom HTTP/HTTPS requests
function makeRequest(method, endpoint, payload = null) {
  return new Promise((resolve) => {
    const urlString = `${CONFIG.targetUrl}${endpoint}`;
    const parsedUrl = new URL(urlString);
    const postData = payload ? JSON.stringify(payload) : '';

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    };

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const requestStart = performance.now();

    METRICS.requestsSent++;
    const endpointKey = endpoint.includes('health') ? 'health' :
                        endpoint.includes('enroll') ? 'enroll' :
                        endpoint.includes('write') ? (payload?.data?.status === 'completed' ? 'submit' : 'heartbeat') : 'health';
    
    METRICS.endpoints[endpointKey].sent++;

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const latency = performance.now() - requestStart;
        METRICS.latencies.push(latency);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          METRICS.requestsSuccess++;
          METRICS.endpoints[endpointKey].success++;
          resolve({ success: true, statusCode: res.statusCode, data });
        } else {
          METRICS.requestsFailed++;
          METRICS.endpoints[endpointKey].failed++;
          const errorMsg = `HTTP ${res.statusCode}: ${data.substring(0, 100)}`;
          METRICS.errors[errorMsg] = (METRICS.errors[errorMsg] || 0) + 1;
          resolve({ success: false, statusCode: res.statusCode, error: errorMsg });
        }
      });
    });

    req.on('error', (err) => {
      const latency = performance.now() - requestStart;
      METRICS.latencies.push(latency);
      METRICS.requestsFailed++;
      METRICS.endpoints[endpointKey].failed++;
      const errorMsg = `Socket Error: ${err.message}`;
      METRICS.errors[errorMsg] = (METRICS.errors[errorMsg] || 0) + 1;
      resolve({ success: false, error: errorMsg });
    });

    if (payload) {
      req.write(postData);
    }
    req.end();
  });
}

// Throttled request runner to implement strict connection limits
function enqueueRequest(method, endpoint, payload = null) {
  return new Promise((resolve) => {
    const run = async () => {
      activeRequestsCount++;
      try {
        const result = await makeRequest(method, endpoint, payload);
        resolve(result);
      } finally {
        activeRequestsCount--;
        if (requestQueue.length > 0) {
          const next = requestQueue.shift();
          next();
        }
      }
    };

    if (activeRequestsCount < CONFIG.concurrencyLimit) {
      run();
    } else {
      requestQueue.push(run);
    }
  });
}

// Generate static sample questions answers
function getRandomAnswers() {
  const ans = [];
  for (let i = 0; i < 20; i++) {
    ans.push(Math.floor(Math.random() * 4));
  }
  return ans;
}

// Simulate single student life cycle
async function simulateStudent(studentIndex) {
  const rollNumber = `test-roll-${studentIndex}-${Math.floor(Math.random() * 100000)}`;
  const schoolId = 'school-core-node-1';
  const examId = 'exam-sandbox-core-99';
  const matchedStudentId = `std_${schoolId}_${rollNumber}`;

  // Stagger start to avoid artificial lockups
  const staggerDelay = Math.random() * CONFIG.rampUpMs;
  await new Promise(r => setTimeout(r, staggerDelay));

  // Step 1: Gatekeeper Enroll / Session Creation
  const enrollPayload = {
    matchedStudentId,
    rollNumber,
    finalSchoolId: schoolId,
    finalExamId: examId,
    examTitle: 'Stress Test Simulated Exam',
    clientFootprint: `StressTesterWorkerNode_${studentIndex}`,
    username: `Simulated Candidate #${studentIndex}`
  };

  const enrollRes = await enqueueRequest('POST', '/api/gatekeeper/enroll', enrollPayload);
  if (!enrollRes.success) {
    return; // Stop simulation if registration fails
  }

  let attemptId = null;
  try {
    const parsed = JSON.parse(enrollRes.data);
    attemptId = parsed.attemptIdRaw;
  } catch (e) {
    attemptId = `att_${examId}_${matchedStudentId}`;
  }

  // Step 2: Periodic Answer Heartbeat Updates
  const intervalId = setInterval(async () => {
    const heartbeatPayload = {
      type: 'update',
      collectionName: 'attempts',
      docId: attemptId,
      data: {
        timePerQuestion: { 0: Math.floor(Math.random() * 30) },
        status: 'in-progress'
      }
    };
    await enqueueRequest('POST', '/api/db/write', heartbeatPayload);
  }, CONFIG.heartbeatIntervalMs);

  // Keep simulator active for configured duration, then submit
  await new Promise(r => setTimeout(r, CONFIG.testDurationSeconds * 1000));
  clearInterval(intervalId);

  // Step 3: Final Exam Submit
  const submitPayload = {
    type: 'update',
    collectionName: 'attempts',
    docId: attemptId,
    data: {
      score: Math.floor(Math.random() * 80) + 20,
      accuracy: Math.floor(Math.random() * 40) + 60,
      avgTimePerCorrect: Math.floor(Math.random() * 10) + 5,
      status: 'completed',
      answers: getRandomAnswers(),
      endTime: new Date().toISOString()
    }
  };

  await enqueueRequest('POST', '/api/db/write', submitPayload);
}

// Print real-time diagnostics metrics progress
function printDiagnostics() {
  const elapsed = (Date.now() - METRICS.startTime) / 1000;
  const rps = elapsed > 0 ? (METRICS.requestsSent / elapsed).toFixed(1) : 0;
  console.log(`[PROGRESS] Elapsed: ${elapsed.toFixed(1)}s | Req: ${METRICS.requestsSent} | Success: ${METRICS.requestsSuccess} | Failed: ${METRICS.requestsFailed} | RPS: ${rps}`);
}

// Main runner orchestrator
async function run() {
  // First, verify connection by hitting /api/health
  console.log('📡 Testing initial link-ingress connectivity...');
  const healthCheck = await makeRequest('GET', '/api/health');
  if (!healthCheck.success) {
    console.error(`❌ Connection failed! Ensure ${CONFIG.targetUrl} is online and reachable.`);
    process.exit(1);
  }
  console.log('✅ Target connectivity validated successfully.\n🔥 Starting load injection...');

  METRICS.startTime = Date.now();
  const diagnosticsInterval = setInterval(printDiagnostics, 2000);

  // Spawn simulated students
  const studentPromises = [];
  for (let i = 1; i <= CONFIG.totalStudents; i++) {
    studentPromises.push(simulateStudent(i));
  }

  // Wait for all simulated students to complete their exam cycle
  await Promise.all(studentPromises);
  
  clearInterval(diagnosticsInterval);
  METRICS.endTime = Date.now();

  // Calculate stats
  const totalDuration = (METRICS.endTime - METRICS.startTime) / 1000;
  const totalRps = (METRICS.requestsSent / totalDuration).toFixed(1);
  
  // Sort latencies to compute median and percentiles
  const sortedLatencies = [...METRICS.latencies].sort((a, b) => a - b);
  const minLatency = sortedLatencies.length ? sortedLatencies[0].toFixed(1) : 0;
  const maxLatency = sortedLatencies.length ? sortedLatencies[sortedLatencies.length - 1].toFixed(1) : 0;
  const medianLatency = sortedLatencies.length ? sortedLatencies[Math.floor(sortedLatencies.length * 0.5)].toFixed(1) : 0;
  const p95Latency = sortedLatencies.length ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)].toFixed(1) : 0;
  
  let avgLatency = 0;
  if (sortedLatencies.length) {
    const sum = sortedLatencies.reduce((a, b) => a + b, 0);
    avgLatency = (sum / sortedLatencies.length).toFixed(1);
  }

  const successPercentage = METRICS.requestsSent > 0 ? ((METRICS.requestsSuccess / METRICS.requestsSent) * 100).toFixed(1) : 0;

  console.log(`
===================================================================
📊 LOAD TESTING REPORT & PERFORMANCE ANALYSIS
===================================================================
⏱️ Duration:           ${totalDuration.toFixed(1)} seconds
📈 Total Requests:     ${METRICS.requestsSent}
✅ Success Count:      ${METRICS.requestsSuccess} (${successPercentage}%)
❌ Failure Count:      ${METRICS.requestsFailed}
⚡ Overall Throughput: ${totalRps} req/sec

-------------------------------------------------------------------
🏎️ LATENCY PROFILE (ms):
-------------------------------------------------------------------
  Min:     ${minLatency} ms
  Max:     ${maxLatency} ms
  Average: ${avgLatency} ms
  Median:  ${medianLatency} ms
  95th%:   ${p95Latency} ms

-------------------------------------------------------------------
📌 ENDPOINT PERFORMANCE MATRIX:
-------------------------------------------------------------------
  1. Gatekeeper Enroll (/api/gatekeeper/enroll)
     ├─ Sent:    ${METRICS.endpoints.enroll.sent}
     ├─ Success: ${METRICS.endpoints.enroll.success}
     └─ Failed:  ${METRICS.endpoints.enroll.failed}

  2. Answer Heartbeats (/api/db/write - update)
     ├─ Sent:    ${METRICS.endpoints.heartbeat.sent}
     ├─ Success: ${METRICS.endpoints.heartbeat.success}
     └─ Failed:  ${METRICS.endpoints.heartbeat.failed}

  3. Exam Submissions (/api/db/write - completed)
     ├─ Sent:    ${METRICS.endpoints.submit.sent}
     ├─ Success: ${METRICS.endpoints.submit.success}
     └─ Failed:  ${METRICS.endpoints.submit.failed}

  4. System Diagnostics (/api/health)
     ├─ Sent:    ${METRICS.endpoints.health.sent}
     ├─ Success: ${METRICS.endpoints.health.success}
     └─ Failed:  ${METRICS.endpoints.health.failed}
`);

  if (Object.keys(METRICS.errors).length > 0) {
    console.log(`-------------------------------------------------------------------
⚠️ ERROR DISTRIBUTION:
-------------------------------------------------------------------`);
    for (const [err, count] of Object.entries(METRICS.errors)) {
      console.log(`  • [${count}x] ${err}`);
    }
  }

  console.log(`===================================================================\n`);
}

run();
