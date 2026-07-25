import Redis from 'ioredis';

// PERSISTENT REDIS CONNECTION CLIENT & LOCAL SUBMISSION LOCK FALLBACK
const redisUrl = process.env.REDIS_URL;
const redisHost = process.env.REDIS_HOST;
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD;

let redisClient: Redis | null = null;
const localSubmissionLocks = new Map<string, number>();

if (redisUrl || redisHost) {
  try {
    const options: any = {
      connectTimeout: 5000,
      maxRetriesPerRequest: 3,
    };
    if (redisUrl) {
      redisClient = new Redis(redisUrl, options);
    } else {
      redisClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword || undefined,
        ...options
      });
    }
    redisClient.on('error', (err) => {
      console.error('[Redis Client Error]:', err.message || String(err));
    });
    console.log('[Redis] Connected persistently for rate limiting and duplicate prevention.');
  } catch (err) {
    console.error('[Redis] Persistent connection failed to initialize:', err);
  }
}

// Rate limiting & duplicate submission prevention middleware using Redis & Memory Fallback
export async function checkDuplicateSubmission(req: any, res: any, next: () => void) {
  const { type, collectionName, docId, data } = req.body;

  // Detect if this is an exam submission
  const isSubmission = collectionName === 'attempts' &&
                       (type === 'update' || type === 'set') &&
                       data &&
                       data.status === 'completed';

  if (!isSubmission || !docId) {
    return next();
  }

  const lockKey = `exam_submit_lock:${docId}`;
  const now = Date.now();

  // 1. Check local memory lock first (instant, works as high-performance barrier)
  if (localSubmissionLocks.has(lockKey) && localSubmissionLocks.get(lockKey)! > now) {
    console.warn(`[DUPLICATE BLOCKED - MEMORY] Duplicate submission blocked for attempt: ${docId}`);
    return res.status(429).json({
      error: 'Duplicate submission request detected. Your exam submission is already in progress, please wait.',
      code: 'DUPLICATE_SUBMISSION'
    });
  }

  // 2. If Redis is active, try to acquire lock via Redis SET with NX and PX (TTL of 15 seconds)
  if (redisClient) {
    try {
      const acquired = await redisClient.set(lockKey, 'locked', 'PX', 15000, 'NX');
      if (!acquired) {
        console.warn(`[DUPLICATE BLOCKED - REDIS] Duplicate submission blocked for attempt: ${docId}`);
        return res.status(429).json({
          error: 'Duplicate submission request detected. Your exam submission is already in progress, please wait.',
          code: 'DUPLICATE_SUBMISSION'
        });
      }
    } catch (err) {
      console.error('[Redis Lock Error] Failed to acquire lock via Redis, falling back to memory lock:', err);
      // Fallback: acquire memory lock for 15s
      localSubmissionLocks.set(lockKey, now + 15000);
    }
  } else {
    // Fallback: acquire memory lock for 15s
    localSubmissionLocks.set(lockKey, now + 15000);
  }

  // Periodic cleanup of expired local locks to avoid memory leaks (1% chance per request)
  if (Math.random() < 0.01) {
    for (const [key, expiry] of localSubmissionLocks.entries()) {
      if (expiry < now) {
        localSubmissionLocks.delete(key);
      }
    }
  }

  next();
}
