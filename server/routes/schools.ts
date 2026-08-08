import express from 'express';
import { clientDb, clientCollection, clientDoc, clientGetDoc, clientGetDocs } from '../firestoreClient';
import { queryCache, CACHE_TTLS } from '../db/cache';

const router = express.Router();

// Named counterpart to POST /api/db/query {collectionName:'schools'} — same public-read
// collection (COLLECTION_ACCESS['schools']), same cache TTL, just a resource-shaped route
// instead of a generic proxy call. Additive only: the generic route still works unchanged.
router.get('/api/schools', async (_req, res) => {
  try {
    const cacheKey = JSON.stringify({ collectionName: 'schools', constraints: [] });
    const ttl = CACHE_TTLS['schools'] || 0;
    const cached = queryCache.get(cacheKey);
    if (ttl > 0 && cached && (Date.now() - cached.timestamp < ttl)) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const snap = await clientGetDocs(clientCollection(clientDb, 'schools'));
    const docList = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));

    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
    }
    return res.status(200).json({ success: true, data: docList });
  } catch (err: any) {
    console.error('[Schools] Failed to list schools:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.get('/api/schools/:schoolId', async (req, res) => {
  const { schoolId } = req.params;
  try {
    const snap = await clientGetDoc(clientDoc(clientDb, 'schools', schoolId));
    if (!snap.exists()) {
      return res.status(200).json({ success: true, data: { id: schoolId, exists: false } });
    }
    return res.status(200).json({ success: true, data: { id: snap.id, exists: true, data: snap.data() } });
  } catch (err: any) {
    console.error('[Schools] Failed to fetch school:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
