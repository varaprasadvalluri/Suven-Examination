import express from 'express';
import { clientDb, clientCollection, clientGetDocs } from '../firestoreClient';
import { queryCache, CACHE_TTLS } from '../db/cache';

const router = express.Router();

// Named counterpart to POST /api/db/query {collectionName:'login_options'} — public read,
// same cache TTL as the generic proxy. Additive only.
router.get('/api/login-options', async (_req, res) => {
  try {
    const cacheKey = JSON.stringify({ collectionName: 'login_options', constraints: [] });
    const ttl = CACHE_TTLS['login_options'] || 0;
    const cached = queryCache.get(cacheKey);
    if (ttl > 0 && cached && (Date.now() - cached.timestamp < ttl)) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const snap = await clientGetDocs(clientCollection(clientDb, 'login_options'));
    const docList = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));

    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
    }
    return res.status(200).json({ success: true, data: docList });
  } catch (err: any) {
    console.error('[LoginOptions] Failed to list login options:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
