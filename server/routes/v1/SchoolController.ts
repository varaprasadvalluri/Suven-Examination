import express from 'express';
import { schoolDao } from '../../dao';
import { queryCache, CACHE_TTLS } from '../../db/cache';
import { asyncHandler } from '../../middleware/errorHandler';

const router = express.Router();

// v1 counterpart of server/routes/schools.ts, calling SchoolDao instead of firestoreClient
// directly. Same behavior (public read, same cache TTL), additive only — the unversioned
// /api/schools route is untouched and is what the frontend currently calls.
/**
 * @openapi
 * /api/v1/schools:
 *   get:
 *     summary: List all schools
 *     description: Public read, cached. No authentication required.
 *     tags: [Schools]
 *     security: []
 *     responses:
 *       200:
 *         description: List of schools
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 *                 fromCache: { type: boolean }
 */
router.get(
  '/api/v1/schools',
  asyncHandler(async (_req, res) => {
    const cacheKey = JSON.stringify({ collectionName: 'schools', constraints: [] });
    const ttl = CACHE_TTLS['schools'] || 0;
    const cached = queryCache.get(cacheKey);
    if (ttl > 0 && cached && Date.now() - cached.timestamp < ttl) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const docList = await schoolDao.findAll();

    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
    }
    return res.status(200).json({ success: true, data: docList });
  })
);

/**
 * @openapi
 * /api/v1/schools/{schoolId}:
 *   get:
 *     summary: Get a single school by ID
 *     description: Public read. No authentication required.
 *     tags: [Schools]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: School document (or a not-found result shape from the DAO)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.get(
  '/api/v1/schools/:schoolId',
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;
    const schoolResult = await schoolDao.findById(schoolId);
    return res.status(200).json({ success: true, data: schoolResult });
  })
);

export default router;
