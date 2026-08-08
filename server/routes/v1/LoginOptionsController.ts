import express from 'express';
import { loginOptionsDao } from '../../dao/FirestoreLoginOptionsDao';
import { queryCache, CACHE_TTLS } from '../../db/cache';

const router = express.Router();

// v1 counterpart of server/routes/loginOptions.ts. Additive only.
router.get('/api/v1/login-options', async (_req, res) => {
  try {
    const cacheKey = JSON.stringify({ collectionName: 'login_options', constraints: [] });
    const ttl = CACHE_TTLS['login_options'] || 0;
    const cached = queryCache.get(cacheKey);
    if (ttl > 0 && cached && (Date.now() - cached.timestamp < ttl)) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const docList = await loginOptionsDao.findAll();

    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
    }
    return res.status(200).json({ success: true, data: docList });
  } catch (err: any) {
    console.error('[LoginOptionsController] Failed to list login options:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
