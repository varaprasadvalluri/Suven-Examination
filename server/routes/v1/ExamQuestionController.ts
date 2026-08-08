import express from 'express';
import { resolveAuth, RequestAuth } from '../../auth/middleware';
import { sanitizeForPublicRead } from '../../authorization';
import { clientDb, clientDoc, clientGetDoc } from '../../firestoreClient';
import { questionDao } from '../../dao/FirestoreQuestionDao';
import { queryCache, CACHE_TTLS } from '../../db/cache';

const router = express.Router();

// Faithful copy of the answer-key sanitization gate (also duplicated in
// server/routes/examQuestions.ts and server/routes/db.ts) — gated on attempt status ===
// 'completed', never doc existence. This is security-critical (previously-fixed leak); kept
// identical rather than refactored into a shared helper so each route's behavior is
// independently readable and reviewable, matching the existing pattern in this codebase.
async function shouldSanitizeQuestions(examId: string, caller: RequestAuth | null): Promise<boolean> {
  if (!caller) return true;
  if (caller.role !== 'student') return false;
  const attemptSnap = await clientGetDoc(clientDoc(clientDb, 'attempts', `att_${examId}_${caller.uid}`));
  if (!attemptSnap.exists()) return true;
  const status = (attemptSnap.data() as any)?.status;
  return status !== 'completed';
}

// v1 counterpart of server/routes/examQuestions.ts, calling QuestionDao instead of
// firestoreClient directly. Additive only.
router.get('/api/v1/exams/:examId/questions', async (req, res) => {
  const { examId } = req.params;
  try {
    const caller = await resolveAuth(req);
    const shouldSanitize = await shouldSanitizeQuestions(examId, caller);

    const cacheKey = JSON.stringify({ collectionName: 'questions', constraints: [{ type: 'where', field: 'examId', op: '==', value: examId }] });
    const ttl = CACHE_TTLS['questions'] || 0;
    const cached = queryCache.get(cacheKey);

    let docList: { id: string; data: any }[];
    if (ttl > 0 && cached && (Date.now() - cached.timestamp < ttl)) {
      docList = cached.data;
    } else {
      docList = await questionDao.findByExamId(examId);
      if (ttl > 0) {
        queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
      }
    }

    const payload = shouldSanitize
      ? docList.map(item => ({ ...item, data: sanitizeForPublicRead('questions', item.data) }))
      : docList;

    return res.status(200).json({ success: true, data: payload });
  } catch (err: any) {
    console.error('[ExamQuestionController] Failed to list questions:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
