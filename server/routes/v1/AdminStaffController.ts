import express from 'express';
import { requireSession, requireRole } from '../../auth/middleware';
import { adminStaffDao } from '../../dao/FirestoreAdminStaffDao';

const router = express.Router();

// v1 counterpart of server/routes/adminStaff.ts, calling AdminStaffDao instead of
// firestoreClient directly. Additive only.
router.get('/api/v1/admin/staff', requireSession, requireRole('admin'), async (_req, res) => {
  try {
    const data = await adminStaffDao.findAll();
    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error('[AdminStaffController] Failed to list staff:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
