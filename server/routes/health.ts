import express from 'express';
import Redis from 'ioredis';
import { clientDb, clientCollection, clientQuery, clientLimit, clientGetDocs } from '../firestoreClient';

const router = express.Router();

const handleHealthCheck = async (req: any, res: any) => {
  const start = performance.now();
  let firestoreStatus = 'unknown';
  let firestoreLatency = -1;
  let firestoreDetails = '';
  let redisStatus = 'unknown';
  let redisLatency = -1;
  let redisDetails = 'unconfigured';

  // 1. Validate Firestore connectivity dynamically
  try {
    const fStart = performance.now();
    // Fetch a single document metadata from the exams collection to test round-trip latency
    const testQuery = clientQuery(clientCollection(clientDb, 'exams'), clientLimit(1));
    await clientGetDocs(testQuery);
    firestoreLatency = parseFloat((performance.now() - fStart).toFixed(1));
    firestoreStatus = 'connected';
  } catch (err: any) {
    firestoreStatus = 'error';
    firestoreDetails = err.message || String(err);
    console.error('[Health Check] Firestore error:', firestoreDetails);
  }

  // 2. Validate Redis connectivity dynamically if details are configured
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisPassword = process.env.REDIS_PASSWORD;

  const hasRedisConfig = !!(redisUrl || redisHost);

  if (hasRedisConfig) {
    let tempRedis: Redis | null = null;
    try {
      const rStart = performance.now();
      const options: any = {
        connectTimeout: 1500, // Fail-fast so health checks do not hang during network splits
        maxRetriesPerRequest: 1,
        retryStrategy: () => null // Prevent reconnection loops
      };

      if (redisUrl) {
        tempRedis = new Redis(redisUrl, options);
      } else {
        tempRedis = new Redis({
          host: redisHost,
          port: redisPort,
          password: redisPassword || undefined,
          ...options
        });
      }

      const pingResult = await tempRedis.ping();
      redisLatency = parseFloat((performance.now() - rStart).toFixed(1));

      if (pingResult === 'PONG') {
        redisStatus = 'connected';
        redisDetails = 'healthy';
      } else {
        redisStatus = 'degraded';
        redisDetails = `Mismatched ping response: ${pingResult}`;
      }
    } catch (err: any) {
      redisStatus = 'offline';
      redisDetails = err.message || String(err);
      console.error('[Health Check] Redis error:', redisDetails);
    } finally {
      if (tempRedis) {
        try {
          tempRedis.disconnect();
        } catch (e) {}
      }
    }
  } else {
    redisStatus = 'unconfigured';
    redisDetails = 'No active Redis environmental keys declared. Falling back to primary cache layers.';
  }

  const totalDuration = parseFloat((performance.now() - start).toFixed(1));
  const overallStatus = (firestoreStatus === 'connected' && (redisStatus === 'connected' || redisStatus === 'unconfigured')) ? 'healthy' : 'degraded';

  // Publicly reachable, unauthenticated (load balancers/uptime monitors hit this) — keep the
  // response to status/latency only, no projectId/databaseId/memoryUsage/raw error strings,
  // since those are recon info for an anonymous caller and aren't needed to answer "is it up".
  res.status(overallStatus === 'healthy' ? 200 : 500).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    totalLatencyMs: totalDuration,
    services: {
      firestore: {
        status: firestoreStatus,
        latencyMs: firestoreLatency
      },
      redis: {
        status: redisStatus,
        latencyMs: redisLatency
      }
    }
  });
};

router.get('/health', handleHealthCheck);
router.get('/api/health', handleHealthCheck);

export default router;
