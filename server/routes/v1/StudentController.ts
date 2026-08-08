import express from 'express';
import { requireSession, requireRole } from '../../auth/middleware';
import { authorizeWrite } from '../../authorization';
import { studentDao } from '../../dao/FirestoreStudentDao';

const router = express.Router();

// v1 counterpart of server/routes/students.ts, calling StudentDao instead of firestoreClient/
// enqueueWrite directly. Same tenant-scoping and authorizeWrite checks, byte-for-byte —
// additive only, the unversioned routes are untouched.
router.get('/api/v1/schools/:schoolId/students', requireSession, requireRole('admin', 'school'), async (req: any, res) => {
  const { schoolId } = req.params;
  if (req.auth.role === 'school' && req.auth.schoolId !== schoolId) {
    return res.status(403).json({ error: 'Forbidden: you may only list your own school\'s students' });
  }

  try {
    const docList = await studentDao.findBySchool(schoolId);
    return res.status(200).json({ success: true, data: docList });
  } catch (err: any) {
    console.error('[StudentController] Failed to list students:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/api/v1/schools/:schoolId/students', requireSession, requireRole('admin', 'school'), async (req: any, res) => {
  const { schoolId } = req.params;
  const payload = { ...req.body, schoolId, role: 'student' };

  try {
    const decision = await authorizeWrite(req.auth, 'add', 'users', undefined, payload);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const result = await studentDao.create(decision.data);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[StudentController] Failed to onboard student:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.patch('/api/v1/students/:studentId', requireSession, async (req: any, res) => {
  const { studentId } = req.params;

  try {
    const decision = await authorizeWrite(req.auth, 'update', 'users', studentId, req.body);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const result = await studentDao.update(studentId, decision.data);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[StudentController] Failed to update student:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
