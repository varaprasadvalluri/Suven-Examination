import express from 'express';
import { requireSession, requireRole } from '../../auth/middleware';
import { adminStaffDao } from '../../dao';
import { asyncHandler } from '../../middleware/errorHandler';

const router = express.Router();

// v1 counterpart of server/routes/adminStaff.ts, calling AdminStaffDao instead of
// firestoreClient directly. Additive only.
/**
 * @openapi
 * /api/v1/admin/staff:
 *   get:
 *     summary: List admin staff accounts
 *     description: Admin-only.
 *     tags: [Admin Staff]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of admin staff documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not admin
 */
router.get(
  '/api/v1/admin/staff',
  requireSession,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const adminStaffList = await adminStaffDao.findAll();
    return res.status(200).json({ success: true, data: adminStaffList });
  })
);

export default router;
