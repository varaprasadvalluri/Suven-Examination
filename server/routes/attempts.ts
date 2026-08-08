import express from 'express';
import { requireSession } from '../auth/middleware';
import { authorizeWrite, scopeFieldFor, scopeValueFor, ProxyRole } from '../authorization';
import { checkDuplicateSubmission } from '../middleware/duplicateSubmission';
import { enqueueWrite } from '../db/writeQueue';
import { clientDb, clientDoc, clientGetDoc } from '../firestoreClient';
import { recomputeAttemptScore } from '../lib/scoreVerification';

const router = express.Router();

// Named counterpart to POST /api/db/query {collectionName:'attempts', docId} — same tenant
// scoping as the generic proxy (SCOPE_FIELD['attempts']: school by schoolId, student by
// studentId, admin unrestricted). Reports out-of-scope as not-found, matching the generic
// route's behavior of not confirming a doc's existence to a caller who can't read it.
router.get('/api/attempts/:attemptId', requireSession, async (req: any, res) => {
  const { attemptId } = req.params;
  try {
    const snap = await clientGetDoc(clientDoc(clientDb, 'attempts', attemptId));
    if (!snap.exists()) {
      return res.status(200).json({ success: true, data: { id: attemptId, exists: false } });
    }
    const docData = snap.data() as any;

    if (req.auth.role !== 'admin') {
      const scopeField = scopeFieldFor('attempts', req.auth.role as ProxyRole);
      const scopeValue = scopeValueFor(req.auth, req.auth.role as ProxyRole);
      if (scopeField && docData[scopeField] !== scopeValue) {
        return res.status(200).json({ success: true, data: { id: attemptId, exists: false } });
      }
    }

    return res.status(200).json({ success: true, data: { id: snap.id, exists: true, data: docData } });
  } catch (err: any) {
    console.error('[Attempts] Failed to fetch attempt:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Named counterpart to POST /api/db/write {collectionName:'attempts', type:'update', data:
// {status:'completed', ...}} — normalizes the request into that same generic-proxy shape so
// it reuses checkDuplicateSubmission (the exam-submission dup-lock) and authorizeWrite (tenant
// ownership check) completely unchanged, rather than re-implementing either. Additive only.
router.post('/api/attempts/:attemptId/submit', requireSession, (req: any, _res, next) => {
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
    // Never trust a client-submitted score/accuracy — recompute from the real answer key
    // before this write is authorized or queued. See server/lib/scoreVerification.ts.
    const verified = await recomputeAttemptScore(docId, data.answers || []);
    data.score = verified.score;
    data.accuracy = verified.accuracy;

    const decision = await authorizeWrite(req.auth, 'update', 'attempts', docId, data);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    const result = await enqueueWrite({ type: 'update', collectionName: 'attempts', docId, data: decision.data });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[Attempts] Failed to submit attempt:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
