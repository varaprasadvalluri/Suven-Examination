import express from 'express';
import { loginOptionsDao } from '../../../../../composition';
import { readThrough } from '../../../../out/firestore/cache';
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
    const { data, fromCache } = await readThrough('login_options', () => loginOptionsDao.findAll());
    return res.status(200).json({ success: true, data, ...(fromCache ? { fromCache: true } : {}) });
  })
);

export default router;
