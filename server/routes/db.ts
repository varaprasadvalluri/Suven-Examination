import express from 'express';
import { requireSession, requireRole, resolveAuth, RequestAuth } from '../auth/middleware';
import { checkDuplicateSubmission } from '../middleware/duplicateSubmission';
import { queryCache, CACHE_TTLS } from '../db/cache';
import { enqueueWrite } from '../db/writeQueue';
import {
  ProxyRole,
  PUBLIC_READ_COLLECTIONS,
  TOKEN_LOOKUP_COLLECTIONS,
  COLLECTION_ACCESS,
  scopeFieldFor,
  scopeValueFor,
  injectReadScope,
  authorizeWrite,
  sanitizeForPublicRead
} from '../authorization';
import {
  clientDb,
  clientCollection,
  clientDoc,
  clientGetDoc,
  clientGetDocs,
  clientDeleteDoc,
  clientWhere,
  clientLimit,
  clientOrderBy,
  clientStartAfter,
  clientQuery,
  clientGetCountFromServer
} from '../firestoreClient';
import { cleanupCloudinaryAsset } from './cloudinary';
import { cleanupFirebaseStorageAsset, FIREBASE_STORAGE_ID_PREFIX } from './firebaseStorage';
import { mockLoadTestStore } from './gatekeeper';

const router = express.Router();

// Question images can now come from either provider depending on when they were uploaded
// (legacy Cloudinary public_id vs. new Firebase Storage object path prefixed with
// FIREBASE_STORAGE_ID_PREFIX) — route cleanup to whichever one actually stored the asset.
async function cleanupQuestionImage(imagePublicId: string | undefined | null) {
  if (!imagePublicId) return;
  if (imagePublicId.startsWith(FIREBASE_STORAGE_ID_PREFIX)) {
    await cleanupFirebaseStorageAsset(imagePublicId);
  } else {
    await cleanupCloudinaryAsset(imagePublicId);
  }
}

// 3. Question deletion with automatic image cleanup (Cloudinary or Firebase Storage)
router.delete('/api/questions/:questionId', requireSession, requireRole('admin'), async (req, res) => {
  const { questionId } = req.params;
  try {
    const qRef = clientDoc(clientDb, 'questions', questionId);
    const qSnap = await clientGetDoc(qRef);

    if (!qSnap.exists()) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const questionData = qSnap.data() as any;
    await cleanupQuestionImage(questionData.imagePublicId);

    await clientDeleteDoc(qRef);
    return res.status(200).json({
      success: true,
      message: 'Question and associated image deleted successfully.'
    });
  } catch (err: any) {
    console.error("Failed to delete question:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// 4. Exam deletion with automatic image cleanup for all its questions
router.delete('/api/exams/:examId', requireSession, requireRole('admin'), async (req, res) => {
  const { examId } = req.params;
  try {
    // A. Find the exam document first
    const examRef = clientDoc(clientDb, 'exams', examId);
    const examSnap = await clientGetDoc(examRef);
    if (!examSnap.exists()) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    // B. Find all questions under this exam
    const qColRef = clientCollection(clientDb, 'questions');
    const qQuery = clientQuery(qColRef, clientWhere('examId', '==', examId));
    const qSnap = await clientGetDocs(qQuery);

    // C. Delete related question images and documents from Firestore
    for (const qDoc of qSnap.docs) {
      const qData = qDoc.data() as any;
      await cleanupQuestionImage(qData.imagePublicId);
      await clientDeleteDoc(clientDoc(clientDb, 'questions', qDoc.id));
    }

    // D. Delete the exam itself
    await clientDeleteDoc(examRef);

    return res.status(200).json({
      success: true,
      message: 'Exam paper, associated questions, and related image assets deleted successfully.'
    });
  } catch (err: any) {
    console.error("Failed to delete exam:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Proxy Route for Standard Reads (Direct Queries, Document GETs, or snapshot requests)
router.post('/api/db/query', async (req, res) => {
  const { collectionName, constraints = [], docId, countOnly } = req.body;
  if (!collectionName) {
    return res.status(400).json({ error: 'Missing collectionName specification.' });
  }

  // Mirrors /api/db/write's isLoadTestWrite branch: single-doc reads for synthetic
  // load-test identities resolve from mockLoadTestStore instead of hitting Firestore,
  // so a load test never burns real read quota for docs it wrote itself.
  const isLoadTestRead =
    !!docId &&
    (req.headers['x-load-test'] === 'true' ||
      docId.includes('test-roll-') ||
      docId.includes('StressTester'));

  if (isLoadTestRead) {
    const key = `${collectionName}_${docId}`;
    const stored = mockLoadTestStore.get(key);
    if (stored) {
      return res.status(200).json({ success: true, data: { id: docId, exists: true, data: stored } });
    }
    return res.status(200).json({ success: true, data: { id: docId, exists: false } });
  }

  const isPublic = PUBLIC_READ_COLLECTIONS.has(collectionName);
  let auth: RequestAuth | null = null;

  // Best-effort session check on the public `questions` path (skipped for every other public
  // collection — exams/schools/syllabus/login_options never need it, so there's no reason to
  // pay for JWT verification on those hot, high-volume reads). Kept entirely separate from
  // `auth` (which must stay null for public reads so the existing scoping/access logic below
  // is unaffected) — used only to decide questions sanitization, per-role, below.
  const publicQuestionsAuth: RequestAuth | null =
    isPublic && collectionName === 'questions' ? await resolveAuth(req) : null;

  // A bare valid session isn't enough to unlock the answer key for an arbitrary exam — a
  // session is proof of *some* identity, not proof of enrollment in *this* exam. Admin/school
  // stay unrestricted (existing trust boundary for staff/content-owner roles). A student must
  // have their own attempts/att_{examId}_{uid} doc for the exact examId being queried, or the
  // read is sanitized just like a fully anonymous one — otherwise any validly-signed student
  // token (including one obtained via legitimate enrollment in an unrelated exam) could read
  // every other exam's correctAnswerIndex ahead of time by simply changing the examId filter.
  async function shouldSanitizeQuestionsForExam(examId: string | undefined): Promise<boolean> {
    if (collectionName !== 'questions') return false;
    const caller = publicQuestionsAuth;
    if (!caller) return true;
    if (caller.role !== 'student') return false;
    if (!examId) return true;
    const attemptSnap = await clientGetDoc(clientDoc(clientDb, 'attempts', `att_${examId}_${caller.uid}`));
    return !attemptSnap.exists();
  }

  // Applied only to the outgoing response, never to what gets stored in queryCache — the
  // 15s cache for `questions` is keyed without regard to caller identity, so sanitizing
  // before caching would risk serving answer-stripped data to a later caller (of any role)
  // who IS authorized for this exam but happens to land within that cache window, or vice
  // versa leaking full data to one who isn't.
  async function sanitizeQuestionsPayload(rawData: any, examId: string | undefined): Promise<any> {
    if (collectionName !== 'questions') return rawData;
    const shouldSanitize = await shouldSanitizeQuestionsForExam(examId);
    if (!shouldSanitize) return rawData;
    if (Array.isArray(rawData)) {
      return rawData.map((item: any) => ({ ...item, data: sanitizeForPublicRead('questions', item.data) }));
    }
    if (rawData && typeof rawData === 'object' && 'data' in rawData) {
      return { ...rawData, data: sanitizeForPublicRead('questions', rawData.data) };
    }
    return rawData;
  }

  if (!isPublic) {
    auth = await resolveAuth(req);
    if (!auth) {
      // Pre-session exception: a visitor following a shared exam-invite link needs to look
      // up the one secure_exam_links doc matching their token before they have a session —
      // but only a targeted lookup by that token, never an unscoped collection dump.
      const isTokenLookup = TOKEN_LOOKUP_COLLECTIONS.has(collectionName) &&
        !docId && constraints.length === 1 &&
        constraints[0]?.type === 'where' && constraints[0]?.op === '==' &&
        (constraints[0]?.field === 'id' || constraints[0]?.field === 'token') &&
        !!constraints[0]?.value;

      if (!isTokenLookup) {
        return res.status(401).json({ error: 'Unauthorized: Missing, invalid, or expired session' });
      }
    } else {
      const access = COLLECTION_ACCESS[collectionName];
      if (!access || !access.read.includes(auth.role as ProxyRole)) {
        return res.status(403).json({ error: 'Forbidden: role cannot read this collection' });
      }
    }
  }

  const scopedNonAdmin = !!auth && auth.role !== 'admin';
  const scopeField = scopedNonAdmin ? scopeFieldFor(collectionName, auth!.role as ProxyRole) : undefined;
  const scopeValue = scopedNonAdmin ? scopeValueFor(auth!, auth!.role as ProxyRole) : null;

  try {
    // A. Single Document Fetch
    if (docId) {
      const docRef = clientDoc(clientDb, collectionName, docId);
      const snap = await clientGetDoc(docRef);
      if (snap.exists()) {
        const docData = snap.data();
        const scopeFieldValue = scopeField ? (docData as any)?.[scopeField] : undefined;
        if (scopeField && scopeFieldValue !== undefined && scopeFieldValue !== scopeValue) {
          // Report as not-found rather than 403 to avoid confirming out-of-scope doc existence.
          return res.status(200).json({ success: true, data: { id: docId, exists: false } });
        }
        const result = { id: snap.id, exists: true, data: docData };
        if (!scopeField) {
          const ttl = CACHE_TTLS[collectionName] || 0;
          if (ttl > 0) {
            const cacheKey = JSON.stringify({ collectionName, docId });
            queryCache.set(cacheKey, { timestamp: Date.now(), data: result });
          }
        }
        return res.status(200).json({ success: true, data: await sanitizeQuestionsPayload(result, (docData as any)?.examId) });
      } else {
        const result = { id: docId, exists: false };
        return res.status(200).json({ success: true, data: result });
      }
    }

    // B. Structured Collection Queries with sorting/filtering limits
    let effectiveConstraints = constraints;
    if (scopeField) {
      const injected = injectReadScope(auth!, collectionName, constraints);
      if (injected === null) {
        return res.status(403).json({ error: 'Forbidden: query scope does not match your account' });
      }
      effectiveConstraints = injected;
    }

    // Only meaningful for `questions` (see shouldSanitizeQuestionsForExam) — the exact examId
    // being filtered on, if any, so a student's enrollment can be checked against it.
    const queriedExamId = effectiveConstraints.find(
      (c: any) => c.type === 'where' && c.field === 'examId' && c.op === '=='
    )?.value;

    const cacheKey = JSON.stringify({ collectionName, constraints: effectiveConstraints, docId, countOnly });
    const cached = queryCache.get(cacheKey);
    const ttl = CACHE_TTLS[collectionName] || 0;

    if (ttl > 0 && cached && (Date.now() - cached.timestamp < ttl)) {
      return res.status(200).json({ success: true, data: await sanitizeQuestionsPayload(cached.data, queriedExamId), fromCache: true });
    }

    const colRef = clientCollection(clientDb, collectionName);
    const queryArgs: any[] = [colRef];

    for (const c of effectiveConstraints) {
      if (c.type === 'where') {
        queryArgs.push(clientWhere(c.field, c.op, c.value));
      } else if (c.type === 'orderBy') {
        queryArgs.push(clientOrderBy(c.field, c.direction || 'asc'));
      } else if (c.type === 'limit') {
        queryArgs.push(clientLimit(c.value));
      } else if (c.type === 'startAfter' && c.id) {
        const cursorRef = clientDoc(clientDb, collectionName, c.id);
        const cursorSnap = await clientGetDoc(cursorRef);
        if (cursorSnap.exists()) {
          queryArgs.push(clientStartAfter(cursorSnap));
        }
      }
    }

    const q = clientQuery.apply(null, queryArgs as any);

    if (countOnly) {
      const countSnap = await clientGetCountFromServer(q);
      const countData = { count: countSnap.data().count };
      if (ttl > 0) {
        queryCache.set(cacheKey, { timestamp: Date.now(), data: countData });
      }
      return res.status(200).json({ success: true, data: countData });
    }

    const snap = await clientGetDocs(q);

    const docList = snap.docs.map(doc => ({
      id: doc.id,
      data: doc.data()
    }));

    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
    }

    return res.status(200).json({ success: true, data: await sanitizeQuestionsPayload(docList, queriedExamId) });
  } catch (err: any) {
    console.error(`[DB Proxy Read Error] Failed on collection "${collectionName}":`, err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Proxy Route for Cushioning and Batching Writes
router.post('/api/db/write', requireSession, checkDuplicateSubmission, async (req: any, res) => {
  const { type, collectionName, docId, data } = req.body;
  if (!type || !collectionName) {
    return res.status(400).json({ error: 'Missing type or collectionName parameters.' });
  }

  const isLoadTestWrite =
    req.headers['x-load-test'] === 'true' ||
    docId?.includes('test-roll-') ||
    docId?.includes('StressTester') ||
    data?.clientFootprint?.includes('StressTester') ||
    (collectionName === 'attempts' && docId?.startsWith('att_') && docId?.includes('test-roll-'));

  if (isLoadTestWrite) {
    const key = `${collectionName}_${docId || 'autogen'}`;
    const existing = mockLoadTestStore.get(key) || {};
    mockLoadTestStore.set(key, { ...existing, ...data, updatedAt: new Date().toISOString() });
    return res.status(200).json({ success: true, id: docId || 'mock_task_id', isSimulatedLoadTest: true });
  }

  let authorizedData = data;
  try {
    const decision = await authorizeWrite(req.auth, type, collectionName, docId, data);
    if (decision.ok === false) {
      return res.status(decision.status).json({ error: decision.error });
    }
    authorizedData = decision.data;
  } catch (err: any) {
    console.error('[DB Proxy Write Auth Error]', err);
    return res.status(500).json({ error: err.message || String(err) });
  }

  // Push to write queue, creating a promise that resolves upon the queue flush cycle
  enqueueWrite({ type, collectionName, docId, data: authorizedData })
    .then((result: any) => {
      return res.status(200).json(result);
    })
    .catch((err: any) => {
      return res.status(500).json({ error: err.message || String(err) });
    });
});

export default router;
