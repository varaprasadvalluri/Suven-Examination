import express from 'express';
import { clientDb, clientCollection, clientQuery, clientLimit, clientGetDocs } from '../firestoreClient';
import { getQueueDepth } from '../db/writeQueue';
import { isDraining } from '../lib/lifecycle';
import { logger } from '../lib/logger';

const router = express.Router();

// LIVENESS vs READINESS
// ---------------------
// Liveness answers "is this process alive and should it be left running?" — the only correct
// response to a NO is to restart the container. Readiness answers "should the load balancer
// route new requests here right now?" — a NO is temporary and must not cause a restart.
//
// The original single /health conflated them and returned 500 whenever a dependency was
// unreachable. Wired to a Cloud Run liveness probe, one transient dependency failure would
// have restart-looped every instance in the fleet simultaneously. Firestore is the only
// dependency this app cannot serve without, so it is the only one that can fail a probe.

/**
 * @openapi
 * /health/live:
 *   get:
 *     summary: Liveness probe — is the process running and not shutting down?
 *     description: >
 *       Public, unauthenticated. Checks nothing external by design: a dependency outage must
 *       never cause the orchestrator to restart an otherwise-healthy container. Returns 503
 *       only while the process is draining after SIGTERM, so the load balancer stops sending
 *       new requests during a graceful shutdown.
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Process is alive and accepting work
 *       503:
 *         description: Process is draining and about to exit
 */
router.get(['/api/v1/health/live', '/health/live'], (_req, res) => {
  if (isDraining()) {
    return res.status(503).json({ status: 'draining' });
  }
  res.status(200).json({ status: 'alive' });
});

const handleReadiness = async (_req: any, res: any) => {
  const start = performance.now();

  if (isDraining()) {
    return res.status(503).json({ status: 'draining', timestamp: new Date().toISOString() });
  }

  let firestoreStatus: 'connected' | 'error' = 'error';
  let firestoreLatency = -1;
  try {
    const firestoreStart = performance.now();
    const probeQuery = clientQuery(clientCollection(clientDb, 'exams'), clientLimit(1));
    await clientGetDocs(probeQuery);
    firestoreLatency = parseFloat((performance.now() - firestoreStart).toFixed(1));
    firestoreStatus = 'connected';
  } catch (err) {
    logger.error('Readiness probe: Firestore unreachable', { error: err });
  }

  const ready = firestoreStatus === 'connected';

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'unready',
    timestamp: new Date().toISOString(),
    totalLatencyMs: parseFloat((performance.now() - start).toFixed(1)),
    services: {
      firestore: { status: firestoreStatus, latencyMs: firestoreLatency }
    },
    // Leading indicator of write saturation during an exam window — it rises before latency
    // does and long before errors do. Safe to expose: a single integer with no tenant or user
    // information in it. Alert on this, not on error rate.
    writeQueueDepth: getQueueDepth()
  });
};

/**
 * @openapi
 * /health/ready:
 *   get:
 *     summary: Readiness probe — should this instance receive new traffic?
 *     description: >
 *       Public, unauthenticated. Firestore is the only dependency checked, and the only one
 *       that can fail this probe. Response is deliberately minimal (status, latency, write
 *       queue depth) since an anonymous caller shouldn't get recon info.
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: ready — Firestore reachable and the process is not draining
 *       503:
 *         description: unready — Firestore unreachable, or the process is draining
 */
router.get(['/api/v1/health/ready', '/health/ready'], handleReadiness);

// Bare /health and /health/live|ready are kept alongside the versioned paths on purpose:
// container liveness/readiness probes are infrastructure, not application API, and a probe URL
// that moves with an API version is a probe that breaks on a version bump.
router.get(['/health', '/api/health'], handleReadiness);

export default router;
