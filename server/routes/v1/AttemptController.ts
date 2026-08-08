import express from 'express';
import { requireSession } from '../../auth/middleware';
import { authorizeWrite, scopeFieldFor, scopeValueFor, ProxyRole } from '../../authorization';
import { checkDuplicateSubmission } from '../../middleware/duplicateSubmission';
import { attemptDao } from '../../dao/FirestoreAttemptDao';

const router = express.Router();

// v1 counterpart of server/routes/attempts.ts, calling AttemptDao instead of firestoreClient/
// enqueueWrite directly. Same tenant scoping, same dup-submission lock. Additive only.
router.get('/api/v1/attempts/:attemptId', requireSession, async (req: any, res) => {
  const { attemptId } = req.params;
  try {
    const result = await attemptDao.findById(attemptId);
    if (!result.exists) {
      return res.status(200).json({ success: true, data: result });
    }
    const docData = result.data as any;

    if (req.auth.role !== 'admin') {
      const scopeField = scopeFieldFor('attempts', req.auth.role as ProxyRole);
      const scopeValue = scopeValueFor(req.auth, req.auth.role as ProxyRole);
      if (scopeField && docData[scopeField] !== scopeValue) {
        return res.status(200).json({ success: true, data: { id: attemptId, exists: false } });
      }
    }

    return res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    console.error('[AttemptController] Failed to fetch attempt:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/api/v1/attempts/:attemptId/submit', requireSession, (req: any, _res, next) => {
  req.body = {
    type: 'update',
    collectionName: 'attempts',
    docId: req.params.attemptId,
    data: { ...req.body, status: 'completed' }
  };
  next();
}, checkDuplicateSubmission, async (req: any, res) => {
  const { docId, data } = req.body;
  try {
    const decision = await authorizeWrite(req.auth, 'update', 'attempts', docId, data);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const result = await attemptDao.submit(docId, decision.data);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[AttemptController] Failed to submit attempt:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
