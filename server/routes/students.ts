import express from 'express';
import { requireSession, requireRole } from '../auth/middleware';
import { authorizeWrite } from '../authorization';
import { enqueueWrite } from '../db/writeQueue';
import {
  clientDb,
  clientCollection,
  clientQuery,
  clientWhere,
  clientGetDocs
} from '../firestoreClient';

const router = express.Router();

// Named counterpart to POST /api/db/query {collectionName:'users', constraints:[schoolId,
// role=='student']} — same tenant scoping as the generic proxy's SCOPE_FIELD['users'] entry
// (school role may only list its own students; admin may list any school's). Additive only.
router.get('/api/schools/:schoolId/students', requireSession, requireRole('admin', 'school'), async (req: any, res) => {
  const { schoolId } = req.params;
  if (req.auth.role === 'school' && req.auth.schoolId !== schoolId) {
    return res.status(403).json({ error: 'Forbidden: you may only list your own school\'s students' });
  }

  try {
    const q = clientQuery(
      clientCollection(clientDb, 'users'),
      clientWhere('schoolId', '==', schoolId),
      clientWhere('role', '==', 'student')
    );
    const snap = await clientGetDocs(q);
    const docList = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
    return res.status(200).json({ success: true, data: docList });
  } catch (err: any) {
    console.error('[Students] Failed to list students:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Named counterpart to POST /api/db/write {collectionName:'users', type:'add', data:{role:
// 'student', ...}} — reuses authorizeWrite's existing 'users' branch verbatim (role forced to
// 'student', schoolId forced/verified against the caller's own school for a school-role
// caller; admin may onboard into any school via the :schoolId path param). Additive only.
router.post('/api/schools/:schoolId/students', requireSession, requireRole('admin', 'school'), async (req: any, res) => {
  const { schoolId } = req.params;
  const payload = { ...req.body, schoolId, role: 'student' };

  try {
    const decision = await authorizeWrite(req.auth, 'add', 'users', undefined, payload);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const result = await enqueueWrite({ type: 'add', collectionName: 'users', data: decision.data });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[Students] Failed to onboard student:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Named counterpart to POST /api/db/write {collectionName:'users', type:'update', docId:
// studentId} — reuses authorizeWrite's existing 'users' branch verbatim (student may only
// update their own profile and may not touch role/schoolId/permissions; school may only
// update its own students). Additive only.
router.patch('/api/students/:studentId', requireSession, async (req: any, res) => {
  const { studentId } = req.params;

  try {
    const decision = await authorizeWrite(req.auth, 'update', 'users', studentId, req.body);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const result = await enqueueWrite({ type: 'update', collectionName: 'users', docId: studentId, data: decision.data });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[Students] Failed to update student:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
