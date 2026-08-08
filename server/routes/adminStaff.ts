import express from 'express';
import { requireSession, requireRole } from '../auth/middleware';
import { clientDb, clientCollection, clientGetDocs } from '../firestoreClient';

const router = express.Router();

// Named counterpart to POST /api/db/query {collectionName:'admins'|'super_admins'} — both are
// admin-only reads in COLLECTION_ACCESS, combined here into one staff listing. Additive only.
router.get('/api/admin/staff', requireSession, requireRole('admin'), async (_req, res) => {
  try {
    const [adminsSnap, superAdminsSnap] = await Promise.all([
      clientGetDocs(clientCollection(clientDb, 'admins')),
      clientGetDocs(clientCollection(clientDb, 'super_admins'))
    ]);

    const data = [
      ...adminsSnap.docs.map(doc => ({ id: doc.id, source: 'admins', data: doc.data() })),
      ...superAdminsSnap.docs.map(doc => ({ id: doc.id, source: 'super_admins', data: doc.data() }))
    ];

    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error('[AdminStaff] Failed to list staff:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
