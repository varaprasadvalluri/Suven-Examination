import express from 'express';
import { loginOptionsDao } from '../../dao';
import { queryCache, CACHE_TTLS } from '../../db/cache';
import { asyncHandler } from '../../middleware/errorHandler';

const router = express.Router();

// v1 counterpart of server/routes/loginOptions.ts. Additive only.
/**
 * @openapi
 * /api/v1/login-options:
 *   get:
 *     summary: List configured login options
 *     description: Public read, cached. No authentication required.
 *     tags: [Login Options]
 *     security: []
 *     responses:
 *       200:
 *         description: List of login options
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
  '/api/v1/login-options',
  asyncHandler(async (_req, res) => {
    const cacheKey = JSON.stringify({ collectionName: 'login_options', constraints: [] });
    const ttl = CACHE_TTLS['login_options'] || 0;
    const cached = queryCache.get(cacheKey);
    if (ttl > 0 && cached && Date.now() - cached.timestamp < ttl) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const docList = await loginOptionsDao.findAll();

    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
    }
    return res.status(200).json({ success: true, data: docList });
  })
);

export default router;
