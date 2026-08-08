import express from 'express';
import { resolveAuth, RequestAuth } from '../auth/middleware';
import { sanitizeForPublicRead } from '../authorization';
import {
  clientDb,
  clientCollection,
  clientDoc,
  clientGetDoc,
  clientGetDocs,
  clientQuery,
  clientWhere
} from '../firestoreClient';
import { queryCache, CACHE_TTLS } from '../db/cache';

const router = express.Router();

// Faithful copy of server/routes/db.ts's shouldSanitizeQuestionsForExam — a previously-fixed
// critical bug (answer key leaking to a student the instant their attempt doc existed, not
// just after they finished) lived in this exact check. Gated on attempt status === 'completed',
// never on doc existence. Kept in sync deliberately rather than imported, since db.ts's version
// is a closure over that route's local `collectionName`/`publicQuestionsAuth` — this route only
// ever handles 'questions', so the collectionName guard is dropped, logic otherwise identical.
async function shouldSanitizeQuestions(examId: string, caller: RequestAuth | null): Promise<boolean> {
  if (!caller) return true;
  if (caller.role !== 'student') return false;
  const attemptSnap = await clientGetDoc(clientDoc(clientDb, 'attempts', `att_${examId}_${caller.uid}`));
  if (!attemptSnap.exists()) return true;
  const status = (attemptSnap.data() as any)?.status;
  return status !== 'completed';
}

// Named counterpart to POST /api/db/query {collectionName:'questions', constraints:[examId]}
// — same public-read collection, same answer-key sanitization rule, same cache TTL. Additive
// only: the generic route's sanitization logic is untouched, this mirrors it exactly.
router.get('/api/exams/:examId/questions', async (req, res) => {
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
      const q = clientQuery(clientCollection(clientDb, 'questions'), clientWhere('examId', '==', examId));
      const snap = await clientGetDocs(q);
      docList = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
      if (ttl > 0) {
        queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
      }
    }

    const payload = shouldSanitize
      ? docList.map(item => ({ ...item, data: sanitizeForPublicRead('questions', item.data) }))
      : docList;

    return res.status(200).json({ success: true, data: payload });
  } catch (err: any) {
    console.error('[ExamQuestions] Failed to list questions:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
