import express from 'express';
import { requireSession, requireRole, resolveAuth, RequestAuth } from '../middleware/requireSession';
import { checkDuplicateSubmission } from '../middleware/duplicateSubmission';
import { queryCache, CACHE_TTLS } from '../../../out/firestore/cache';
import { enqueueWrite } from '../../../out/firestore/writeQueue';
import { attemptSubmissionService } from '../../../../composition';
import { asyncHandler } from '../middleware/errorHandler';
import { BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError, InternalServerError } from '../../../../lib/errors';
import {
  ProxyRole,
  PUBLIC_READ_COLLECTIONS,
  TOKEN_LOOKUP_COLLECTIONS,
  COLLECTION_ACCESS
} from '../../../../application/services/authorization';
import { scopeFieldFor, scopeValueFor, injectReadScope, authorizeWrite, sanitizeForPublicRead } from '../../../../composition';
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
} from '../../../out/firestore/firestoreClient';
import { deleteMediaAsset } from '../../../../composition';
import { mockLoadTestStore } from '../../../../lib/loadTestStore';
import { LOAD_TEST_SECRET } from '../../../../config';

const router = express.Router();

// Question images can come from either provider depending on when they were uploaded (legacy
// Cloudinary public_id vs. Firebase Storage object path). Which one holds a given asset is the
// MediaStore registry's business, not this route's — deleteMediaAsset asks each store whether
// it owns the id, so the prefix convention lives in one place.
async function cleanupQuestionImage(imagePublicId: string | undefined | null) {
  if (!imagePublicId) return;
  await deleteMediaAsset(imagePublicId);
}

/**
 * @openapi
 * /api/questions/{questionId}:
 *   delete:
 *     summary: Delete a question, cleaning up its associated image asset (Cloudinary or Firebase Storage)
 *     description: Admin role only.
 *     tags: [Database Proxy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: questionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Question and associated image deleted
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: Question not found
 *       500:
 *         description: Server/Firestore error
 */
// 3. Question deletion with automatic image cleanup (Cloudinary or Firebase Storage)
router.delete(
  ['/api/v1/questions/:questionId', '/api/questions/:questionId'],
  requireSession,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const qRef = clientDoc(clientDb, 'questions', questionId);
    const qSnap = await clientGetDoc(qRef);

    if (!qSnap.exists()) {
      throw new NotFoundError('Question not found');
    }

    const questionData = qSnap.data() as any;
    await cleanupQuestionImage(questionData.imagePublicId);

    await clientDeleteDoc(qRef);
    return res.status(200).json({
      success: true,
      message: 'Question and associated image deleted successfully.'
    });
  })
);

/**
 * @openapi
 * /api/exams/{examId}:
 *   delete:
 *     summary: Delete an exam, its questions, and their associated image assets
 *     description: Admin role only.
 *     tags: [Database Proxy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: examId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Exam, questions, and image assets deleted
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: Exam not found
 *       500:
 *         description: Server/Firestore error
 */
// 4. Exam deletion with automatic image cleanup for all its questions
router.delete(
  ['/api/v1/exams/:examId', '/api/exams/:examId'],
  requireSession,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { examId } = req.params;
    // A. Find the exam document first
    const examRef = clientDoc(clientDb, 'exams', examId);
    const examSnap = await clientGetDoc(examRef);
    if (!examSnap.exists()) {
      throw new NotFoundError('Exam not found');
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
  })
);

/**
 * @openapi
 * /api/db/query:
 *   post:
 *     summary: Generic Firestore read proxy (single doc, filtered/sorted collection query, or count)
 *     description: >
 *       The fallback read path for any collection not covered by a dedicated /api/v1/* DAO
 *       route. Public collections (PUBLIC_READ_COLLECTIONS) need no session; everything else
 *       requires one and is checked against COLLECTION_ACCESS for the caller's role, then
 *       automatically scoped (injectReadScope) for non-admin roles so e.g. a school only ever
 *       reads its own students/exams. A narrow pre-session exception exists for a single
 *       targeted token lookup on TOKEN_LOOKUP_COLLECTIONS (e.g. a shared exam-invite link
 *       looking up its own secure_exam_links doc) — never an unscoped dump. The `questions`
 *       collection additionally has its answer-key fields stripped from the response unless
 *       the caller is a student with a completed attempt for the exact examId queried.
 *     tags: [Database Proxy]
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [collectionName]
 *             properties:
 *               collectionName: { type: string }
 *               docId: { type: string, description: "If set, fetches this single document instead of running constraints as a query." }
 *               countOnly: { type: boolean }
 *               constraints:
 *                 type: array
 *                 description: "List of { type: 'where'|'orderBy'|'limit'|'startAfter', field, op, value, direction, id } query-constraint objects."
 *                 items: { type: object }
 *     responses:
 *       200:
 *         description: "Query result (single doc, doc list, or count), possibly served from cache (fromCache: true)"
 *       400:
 *         description: Missing collectionName
 *       401:
 *         description: Non-public collection requires a session
 *       403:
 *         description: Caller's role cannot read this collection, or query scope doesn't match the caller
 *       500:
 *         description: Server/Firestore error
 */
// Proxy Route for Standard Reads (Direct Queries, Document GETs, or snapshot requests)
export const handleCollectionQuery = asyncHandler(async (req: any, res: any) => {
  const { collectionName, constraints = [], docId, countOnly } = req.body;
  if (!collectionName) {
    throw new BadRequestError('Missing collectionName specification.');
  }

  // Single-doc reads for synthetic load-test identities resolve from mockLoadTestStore instead
  // of hitting Firestore, so a load test never burns real read quota for docs it wrote itself.
  //
  // Gated on LOAD_TEST_SECRET, the same server-side secret /api/db/write's isLoadTestWrite
  // branch requires — its comment claimed to mirror that branch while in fact triggering on a
  // bare client-supplied `x-load-test` header, or on nothing more than the substrings
  // "test-roll-"/"StressTester" appearing in an attacker-chosen docId. It leaked nothing (an
  // unknown key answers `exists: false`), but it let any caller force a phantom not-found for
  // a real document whose id happened to contain either substring, and it left a
  // client-controlled switch on a production read path. Unset secret disables it entirely.
  const isLoadTestRead =
    !!docId && !!LOAD_TEST_SECRET && req.headers['x-load-test'] === 'true' && req.headers['x-load-test-secret'] === LOAD_TEST_SECRET;

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
  const publicQuestionsAuth: RequestAuth | null = isPublic && collectionName === 'questions' ? await resolveAuth(req) : null;

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
    if (!attemptSnap.exists()) return true;
    // Checking existence alone was wrong: the attempt doc is created the moment enrollment
    // happens, before the student answers a single question, so this returned "don't sanitize"
    // (i.e. include correctAnswerIndex/numericalAnswer/explanation) from the very first
    // questions fetch of a live, in-progress exam — verified live, a fresh 'started' attempt's
    // own session could read every correct answer over the API the instant the exam opened.
    // Only a genuinely finished attempt should see answers, for the post-submission review.
    const status = (attemptSnap.data() as any)?.status;
    return status !== 'completed';
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
      const isTokenLookup =
        TOKEN_LOOKUP_COLLECTIONS.has(collectionName) &&
        !docId &&
        constraints.length === 1 &&
        constraints[0]?.type === 'where' &&
        constraints[0]?.op === '==' &&
        (constraints[0]?.field === 'id' || constraints[0]?.field === 'token') &&
        !!constraints[0]?.value;

      if (!isTokenLookup) {
        throw new UnauthorizedError('Unauthorized: Missing, invalid, or expired session');
      }
    } else {
      const access = COLLECTION_ACCESS[collectionName];
      if (!access || !access.read.includes(auth.role as ProxyRole)) {
        throw new ForbiddenError('Forbidden: role cannot read this collection');
      }
    }
  }

  const scopedNonAdmin = !!auth && auth.role !== 'admin';
  const scopeField = scopedNonAdmin ? scopeFieldFor(collectionName, auth!.role as ProxyRole) : undefined;
  const scopeValue = scopedNonAdmin ? scopeValueFor(auth!, auth!.role as ProxyRole) : null;

  // A. Single Document Fetch
  if (docId) {
    const singleDocCacheKey = JSON.stringify({ collectionName, docId });
    const singleDocTtl = CACHE_TTLS[collectionName] || 0;

    // READ-through, not just write-through. This block populated queryCache below and never
    // once consulted it, so the cache cost a write per request and saved nothing — every
    // single-document GET went to Firestore.
    //
    // That is the app's single largest read source during an exam. ExamInterface.tsx polls the
    // EXAM document every 6 seconds per student (apiService.ts's onSnapshot is a poller, not a
    // listener) to pick up the admin pause/extra-time flags — a document that changes almost
    // never. At 100k concurrent students that is ~17k reads/sec of one document; the cache
    // collapses it to one read per collection TTL per worker, shared by every student that
    // worker is serving.
    //
    // Gated on `!scopeField` to exactly match the write side below: a tenant-scoped read
    // filters the document against THIS caller's scope, so its result is not shareable and is
    // never cached in the first place.
    if (!scopeField && singleDocTtl > 0) {
      const cachedDoc = queryCache.get(singleDocCacheKey);
      if (cachedDoc && Date.now() - cachedDoc.timestamp < singleDocTtl) {
        const cachedData = cachedDoc.data as any;
        return res.status(200).json({ success: true, data: await sanitizeQuestionsPayload(cachedData, cachedData?.data?.examId) });
      }
    }

    const docRef = clientDoc(clientDb, collectionName, docId);
    const snap = await clientGetDoc(docRef);
    if (snap.exists()) {
      const docData = snap.data();
      const scopeFieldValue = scopeField ? (docData as any)?.[scopeField] : undefined;
      if (scopeField && scopeFieldValue !== undefined && scopeFieldValue !== scopeValue) {
        // Report as not-found rather than 403 to avoid confirming out-of-scope doc existence.
        return res.status(200).json({ success: true, data: { id: docId, exists: false } });
      }
      const singleDocResult = { id: snap.id, exists: true, data: docData };
      if (!scopeField && singleDocTtl > 0) {
        queryCache.set(singleDocCacheKey, { timestamp: Date.now(), data: singleDocResult });
      }
      return res.status(200).json({ success: true, data: await sanitizeQuestionsPayload(singleDocResult, (docData as any)?.examId) });
    } else {
      const notFoundResult = { id: docId, exists: false };
      return res.status(200).json({ success: true, data: notFoundResult });
    }
  }

  // B. Structured Collection Queries with sorting/filtering limits
  let effectiveConstraints = constraints;
  if (scopeField) {
    const injected = injectReadScope(auth!, collectionName, constraints);
    if (injected === null) {
      throw new ForbiddenError('Forbidden: query scope does not match your account');
    }
    effectiveConstraints = injected;
  }

  // Only meaningful for `questions` (see shouldSanitizeQuestionsForExam) — the exact examId
  // being filtered on, if any, so a student's enrollment can be checked against it.
  const queriedExamId = effectiveConstraints.find(
    (constraint: any) => constraint.type === 'where' && constraint.field === 'examId' && constraint.op === '=='
  )?.value;

  const cacheKey = JSON.stringify({ collectionName, constraints: effectiveConstraints, docId, countOnly });
  const cached = queryCache.get(cacheKey);
  const ttl = CACHE_TTLS[collectionName] || 0;

  if (ttl > 0 && cached && Date.now() - cached.timestamp < ttl) {
    return res.status(200).json({ success: true, data: await sanitizeQuestionsPayload(cached.data, queriedExamId), fromCache: true });
  }

  const colRef = clientCollection(clientDb, collectionName);
  const queryArgs: any[] = [colRef];

  for (const constraint of effectiveConstraints) {
    if (constraint.type === 'where') {
      queryArgs.push(clientWhere(constraint.field, constraint.op, constraint.value));
    } else if (constraint.type === 'orderBy') {
      queryArgs.push(clientOrderBy(constraint.field, constraint.direction || 'asc'));
    } else if (constraint.type === 'limit') {
      queryArgs.push(clientLimit(constraint.value));
    } else if (constraint.type === 'startAfter' && constraint.id) {
      const cursorRef = clientDoc(clientDb, collectionName, constraint.id);
      const cursorSnap = await clientGetDoc(cursorRef);
      if (cursorSnap.exists()) {
        queryArgs.push(clientStartAfter(cursorSnap));
      }
    }
  }

  const builtQuery = clientQuery(...(queryArgs as any));

  if (countOnly) {
    const countSnap = await clientGetCountFromServer(builtQuery);
    const countData = { count: countSnap.data().count };
    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: countData });
    }
    return res.status(200).json({ success: true, data: countData });
  }

  const snap = await clientGetDocs(builtQuery);

  const docList = snap.docs.map((doc: any) => ({
    id: doc.id,
    data: doc.data()
  }));

  if (ttl > 0) {
    queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
  }

  return res.status(200).json({ success: true, data: await sanitizeQuestionsPayload(docList, queriedExamId) });
});

/**
 * @openapi
 * /api/db/write:
 *   post:
 *     summary: Generic Firestore write proxy (create/update/delete), queued and authorized server-side
 *     description: >
 *       The fallback write path for any collection not covered by a dedicated /api/v1/* DAO
 *       route. Requires a session. Every write is run through authorizeWrite (role/tenant
 *       checks, field-level restrictions) before being queued (enqueueWrite) — the caller
 *       never writes directly. A final exam submission (collectionName='attempts', status
 *       set to 'completed' in the request) is NOT written as 'completed' directly: the
 *       client-submitted score/accuracy are discarded, the raw answers are persisted
 *       immediately as status='submitted', and grading (recomputeAttemptScore against the
 *       verified answer key, then a status='completed' write) is queued via Cloud Tasks
 *       (server/lib/taskQueue.ts) to run asynchronously on /api/internal/grade-attempt — this
 *       response returns as soon as the submission is durably saved, not after grading
 *       finishes. Supports an internal load-test bypass gated on a server-side secret
 *       (x-load-test-secret header must match LOAD_TEST_SECRET, unset/disabled by
 *       default — fail-closed).
 *     tags: [Database Proxy]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, collectionName]
 *             properties:
 *               type: { type: string, enum: [set, update, delete], description: "Write operation type" }
 *               collectionName: { type: string }
 *               docId: { type: string }
 *               data: { type: object }
 *     responses:
 *       200:
 *         description: "Write queued/applied successfully. For an exam submission specifically, the response is { queued: true } — grading happens asynchronously, not before this response."
 *       400:
 *         description: Missing type or collectionName
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: authorizeWrite denied this write for the caller's role/tenant
 *       500:
 *         description: Server/Firestore error, or failure to persist/queue an exam submission
 */
// Proxy Route for Cushioning and Batching Writes
export const handleCollectionWrite = asyncHandler(async (req: any, res: any) => {
  const { type, collectionName, docId, data } = req.body;
  if (!type || !collectionName) {
    throw new BadRequestError('Missing type or collectionName parameters.');
  }

  // Same trusted-secret gate as gatekeeper.ts's isLoadTestRequest — the old check matched
  // attacker-controlled docId/data substrings ("test-roll-", "StressTester"), letting anyone
  // silently mock a real write (data never persisted) by naming their own doc/fields that way.
  const isLoadTestWrite =
    !!LOAD_TEST_SECRET && req.headers['x-load-test'] === 'true' && req.headers['x-load-test-secret'] === LOAD_TEST_SECRET;

  if (isLoadTestWrite) {
    const key = `${collectionName}_${docId || 'autogen'}`;
    const existing = mockLoadTestStore.get(key) || {};
    mockLoadTestStore.set(key, { ...existing, ...data, updatedAt: new Date().toISOString() });
    return res.status(200).json({ success: true, id: docId || 'mock_task_id', isSimulatedLoadTest: true });
  }

  // Same rule as the named /api/attempts/:id/submit route: a final exam submission's score/
  // accuracy is never trusted from the client, even coming through this generic proxy — closes
  // what would otherwise be a second, unguarded path to a fabricated grade. Grading itself now
  // happens off the request path (server/lib/taskQueue.ts, /api/internal/grade-attempt) so a
  // burst of submissions at exam-end doesn't hold open one HTTP request per student for the
  // full recompute+write chain — see this branch below.
  const isSubmission = collectionName === 'attempts' && (type === 'update' || type === 'set') && data && data.status === 'completed';

  if (isSubmission && docId) {
    // Delegates to the SINGLE submission implementation shared with
    // POST /api/v1/attempts/:id/submit — see server/services/AttemptSubmissionService.ts for
    // why the two paths were collapsed. This route is kept (not rejected in favour of the v1
    // one) because ExamInterface.tsx uses it as its fallback channel when the primary
    // submission call fails, which is a real recovery path on a flaky network.
    try {
      const outcome = await attemptSubmissionService.submit(req.auth, docId, type, data);
      if ('ok' in outcome && outcome.ok === false) {
        return res.status(outcome.status).json({ error: outcome.error });
      }
      return res.status(200).json(outcome);
    } catch (err: any) {
      throw new InternalServerError('Submission saved, but grading could not be queued: ' + (err.message || String(err)));
    }
  }

  let authorizedData = data;
  const decision = await authorizeWrite(req.auth, type, collectionName, docId, data);
  if (decision.ok === false) {
    return res.status(decision.status).json({ error: decision.error });
  }
  authorizedData = decision.data;

  // Push to write queue, creating a promise that resolves upon the queue flush cycle
  const result = await enqueueWrite({ type, collectionName, docId, data: authorizedData });
  return res.status(200).json(result);
});

// The original generic proxy paths. Kept mounted so nothing that still calls them breaks, but
// they are no longer the canonical URLs — see server/routes/v1/ResourceController.ts, which
// exposes the SAME handlers under resource-shaped /api/v1/* paths. Retire these once no caller
// references them.
router.post('/api/db/query', handleCollectionQuery);
router.post('/api/db/write', requireSession, checkDuplicateSubmission, handleCollectionWrite);

export default router;
