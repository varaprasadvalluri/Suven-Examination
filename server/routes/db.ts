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
  authorizeWrite
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
import { mockLoadTestStore } from './gatekeeper';

const router = express.Router();

// 3. Question deletion with automatic Cloudinary image cleanup
router.delete('/api/questions/:questionId', requireSession, requireRole('admin'), async (req, res) => {
  const { questionId } = req.params;
  try {
    const qRef = clientDoc(clientDb, 'questions', questionId);
    const qSnap = await clientGetDoc(qRef);

    if (!qSnap.exists()) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const questionData = qSnap.data() as any;
    if (questionData.imagePublicId) {
      await cleanupCloudinaryAsset(questionData.imagePublicId);
    }

    await clientDeleteDoc(qRef);
    return res.status(200).json({
      success: true,
      message: 'Question and associated Cloudinary image deleted successfully.'
    });
  } catch (err: any) {
    console.error("Failed to delete question:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// 4. Exam deletion with automatic Cloudinary image cleanup for all its questions
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

    // C. Delete related question images from Cloudinary and documents from Firestore
    for (const qDoc of qSnap.docs) {
      const qData = qDoc.data() as any;
      if (qData.imagePublicId) {
        await cleanupCloudinaryAsset(qData.imagePublicId);
      }
      await clientDeleteDoc(clientDoc(clientDb, 'questions', qDoc.id));
    }

    // D. Delete the exam itself
    await clientDeleteDoc(examRef);

    return res.status(200).json({
      success: true,
      message: 'Exam paper, associated questions, and related Cloudinary assets deleted successfully.'
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

  const isPublic = PUBLIC_READ_COLLECTIONS.has(collectionName);
  let auth: RequestAuth | null = null;

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
        return res.status(200).json({ success: true, data: result });
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

    const cacheKey = JSON.stringify({ collectionName, constraints: effectiveConstraints, docId, countOnly });
    const cached = queryCache.get(cacheKey);
    const ttl = CACHE_TTLS[collectionName] || 0;

    if (ttl > 0 && cached && (Date.now() - cached.timestamp < ttl)) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
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

    return res.status(200).json({ success: true, data: docList });
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
