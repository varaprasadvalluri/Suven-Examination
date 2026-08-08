import express from 'express';
import { schoolDao } from '../../dao/FirestoreSchoolDao';
import { queryCache, CACHE_TTLS } from '../../db/cache';

const router = express.Router();

// v1 counterpart of server/routes/schools.ts, calling SchoolDao instead of firestoreClient
// directly. Same behavior (public read, same cache TTL), additive only — the unversioned
// /api/schools route is untouched and is what the frontend currently calls.
router.get('/api/v1/schools', async (_req, res) => {
  try {
    const cacheKey = JSON.stringify({ collectionName: 'schools', constraints: [] });
    const ttl = CACHE_TTLS['schools'] || 0;
    const cached = queryCache.get(cacheKey);
    if (ttl > 0 && cached && (Date.now() - cached.timestamp < ttl)) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const docList = await schoolDao.findAll();

    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
    }
    return res.status(200).json({ success: true, data: docList });
  } catch (err: any) {
    console.error('[SchoolController] Failed to list schools:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/api/v1/schools/:schoolId', async (req, res) => {
  const { schoolId } = req.params;
  try {
    const result = await schoolDao.findById(schoolId);
    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    console.error('[SchoolController] Failed to fetch school:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
