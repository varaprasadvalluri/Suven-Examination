/**
 * Centralized API Service Layer
 * Replaces direct client-side Firestore SDK queries with standard fetch API requests
 * routing through the cushioned, cached Node.js Node Server.
 * Supports exact drop-in function signatures to ensure zero frontend disruption.
 */

import { GlobalDbSubject, CrudType } from './observerPattern';
import { authHeaders, getSessionToken } from './sessionStore';

export const db = { type: 'firestore_proxy_db' };

export function collection(dbInstance: any, collectionName: string) {
  return { type: 'collection', collectionName };
}

export function doc(...args: any[]) {
  // Overloads: doc(db, collection, id) or doc(collectionRef, id)
  if (args.length === 3) {
    return { type: 'doc', collectionName: args[1], id: args[2] };
  }
  if (args.length === 2) {
    const parent = args[0];
    if (parent && parent.type === 'collection') {
      return { type: 'doc', collectionName: parent.collectionName, id: args[1] };
    }
    return { type: 'doc', collectionName: parent, id: args[1] };
  }
  throw new Error('[API Service doc] Unsupported argument combination.');
}

export function query(collectionRef: any, ...constraints: any[]) {
  let existingConstraints: any[] = [];
  let collectionName = collectionRef?.collectionName || '';
  if (collectionRef && collectionRef.type === 'query') {
    existingConstraints = collectionRef.constraints || [];
    collectionName = collectionRef.collectionName;
  }
  const unpackedConstraints = [...existingConstraints];
  for (const c of constraints) {
    if (c) unpackedConstraints.push(c);
  }
  return {
    type: 'query',
    collectionName,
    constraints: unpackedConstraints
  };
}

export function where(field: string, op: string, value: any) {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
  return { type: 'orderBy', field, direction };
}

export function limit(value: number) {
  return { type: 'limit', value };
}

export function startAfter(docSnapshot: any) {
  return { type: 'startAfter', id: docSnapshot ? docSnapshot.id : null };
}

export function serverTimestamp() {
  return new Date().toISOString();
}

// Centralized safe fetch helper to prevent JSON parsing crashes on HTML responses and handle offline states gracefully
async function safeFetchJson(url: string, options: RequestInit = {}, _isRetry = false): Promise<any> {
  // Per-call trace id — echoes the server's requestContext.ts (see server/lib/requestContext.ts),
  // so a failed call here and its matching backend log line share one id, the same way a Sleuth
  // traceId lets you find one request's log lines across a Spring Boot service.
  const traceId = crypto.randomUUID();
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...authHeaders(), 'X-Request-Id': traceId, ...(options.headers || {}) }
    });
    const responseTraceId = response.headers.get('X-Request-Id') || traceId;

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const err = new Error(
        `Server returned non-JSON response (status ${response.status}, content-type: ${contentType || 'none'}).`
      ) as Error & { traceId?: string };
      err.traceId = responseTraceId;
      throw err;
    }

    const payload = await response.json();

    if (!response.ok) {
      // A 401 with a token actually present in storage is almost always transient (e.g. a
      // request landing on a Cloud Run instance mid-rollout to a new revision) rather than a
      // genuinely invalid session — retry once before surfacing it as a failure to the user.
      if (response.status === 401 && !_isRetry && getSessionToken()) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        return safeFetchJson(url, options, true);
      }
      const err = new Error(payload.error || `HTTP error! status: ${response.status}`) as Error & { traceId?: string };
      err.traceId = payload.traceId || responseTraceId;
      throw err;
    }

    return payload;
  } catch (err: any) {
    if (err instanceof TypeError && err.message === 'Failed to fetch') {
      throw new Error('Failed to connect to server. The backend may be temporarily restarting.');
    }
    throw err;
  }
}

function dispatchDbWrite(collectionName?: string, type: CrudType = 'update', docId?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('firestore-db-write', { detail: { collectionName } }));
  }
  if (collectionName) {
    GlobalDbSubject.getInstance().notify({
      type,
      collectionName,
      docId
    });
  }
}

// Client-side drop-in mock of Firestore runTransaction
export async function runTransaction(dbInstance: any, updateFunction: (transaction: any) => Promise<any>) {
  const operations: any[] = [];
  const transactionProxy = {
    get: async (docRef: any) => {
      return await getDoc(docRef);
    },
    set: (docRef: any, data: any, options?: any) => {
      operations.push({ type: 'set', collectionName: docRef.collectionName, docId: docRef.id, data, options });
    },
    update: (docRef: any, data: any) => {
      operations.push({ type: 'update', collectionName: docRef.collectionName, docId: docRef.id, data });
    },
    delete: (docRef: any) => {
      operations.push({ type: 'delete', collectionName: docRef.collectionName, docId: docRef.id });
    }
  };

  const transactionResult = await updateFunction(transactionProxy);

  // Commit all operations accumulated during the transaction
  for (const op of operations) {
    await safeFetchJson('/api/db/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op)
    });
    dispatchDbWrite(op.collectionName, op.type === 'add' ? 'create' : op.type, op.docId);
  }

  dispatchDbWrite();
  return transactionResult;
}

// Client-side drop-in mock of Firestore writeBatch
export function writeBatch(dbInstance: any) {
  const operations: any[] = [];
  return {
    set: (docRef: any, data: any, options?: any) => {
      operations.push({ type: 'set', collectionName: docRef.collectionName, docId: docRef.id, data, options });
    },
    update: (docRef: any, data: any) => {
      operations.push({ type: 'update', collectionName: docRef.collectionName, docId: docRef.id, data });
    },
    delete: (docRef: any) => {
      operations.push({ type: 'delete', collectionName: docRef.collectionName, docId: docRef.id });
    },
    commit: async () => {
      // Execute each queued operation using standard proxy write API
      for (const op of operations) {
        await safeFetchJson('/api/db/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op)
        });
        dispatchDbWrite(op.collectionName, op.type === 'add' ? 'create' : op.type, op.docId);
      }
      dispatchDbWrite();
    }
  };
}

function wrapDocResult(id: string, docData: any) {
  return {
    id,
    exists: () => !!docData?.exists,
    data: () => docData?.data || null
  };
}

function wrapDocsResult(rawDocs: any[]) {
  const docs = rawDocs.map((docItem: any) => ({
    id: docItem.id,
    data: () => docItem.data,
    exists: () => true
  }));

  return {
    docs,
    empty: docs.length === 0,
    forEach: (cb: (doc: any) => void) => docs.forEach(cb)
  };
}

// Named-route fast paths: same request/response contract as the generic /api/db/query proxy
// below, just routed to a resource-shaped endpoint instead (server/routes/v1/SchoolController.ts,
// LoginOptionsController.ts, StudentController.ts, ExamQuestionController.ts,
// AttemptController.ts). Deliberately narrow — only intercepts the EXACT constraint shapes those
// routes actually implement; anything else (extra where/orderBy/limit, a different collection)
// falls through to the generic proxy unchanged below, since a near-match routed to the wrong
// endpoint would silently change query results.
async function tryNamedGetDoc(docRef: any): Promise<ReturnType<typeof wrapDocResult> | null> {
  if (docRef.collectionName === 'schools' && docRef.id) {
    const payload = await safeFetchJson(`/api/v1/schools/${encodeURIComponent(docRef.id)}`);
    return wrapDocResult(docRef.id, payload.data);
  }
  if (docRef.collectionName === 'attempts' && docRef.id) {
    const payload = await safeFetchJson(`/api/v1/attempts/${encodeURIComponent(docRef.id)}`);
    return wrapDocResult(docRef.id, payload.data);
  }
  return null;
}

function isExactWhere(c: any, field: string, op: string, value?: any) {
  return c && c.type === 'where' && c.field === field && c.op === op && (value === undefined || c.value === value);
}

const ATTEMPTS_FILTER_FIELDS = new Set(['examId', 'schoolId', 'studentId', 'status']);
// Must match server/dao/pagination.ts's MAX_PAGE_SIZE — a limit() above this would silently
// get truncated server-side (normalizePageParams caps it), which is exactly the "near-match
// routed to the wrong result" case this matcher is deliberately narrow to avoid. A caller
// asking for more than this (e.g. RankingEngine's 5000-row display cap) falls through to the
// generic proxy unchanged rather than risk a silent truncation regression.
const ATTEMPTS_MAX_LIMIT = 200;

// True only if every constraint is either an `==` where on one of the fixed attempts filter
// fields, a single orderBy, or a single limit within ATTEMPTS_MAX_LIMIT — i.e. exactly the
// shape GET /api/v1/attempts supports. Anything else (startAfter-based cursor pagination, an
// unsupported field, a second orderBy, an oversized limit) falls through to the generic
// proxy unchanged.
function isAttemptsListShape(constraints: any[]): boolean {
  let orderByCount = 0;
  let limitCount = 0;
  for (const c of constraints) {
    if (c.type === 'where') {
      if (c.op !== '==' || !ATTEMPTS_FILTER_FIELDS.has(c.field)) return false;
    } else if (c.type === 'orderBy') {
      orderByCount++;
      if (orderByCount > 1 || !['startTime', 'score', 'endTime'].includes(c.field)) return false;
    } else if (c.type === 'limit') {
      limitCount++;
      if (limitCount > 1 || c.value > ATTEMPTS_MAX_LIMIT) return false;
    } else {
      return false;
    }
  }
  return true;
}

async function tryNamedGetDocs(collectionName: string, constraints: any[]): Promise<any | null> {
  if (collectionName === 'attempts' && isAttemptsListShape(constraints)) {
    const params = new URLSearchParams();
    for (const c of constraints) {
      if (c.type === 'where') params.set(c.field, c.value);
      else if (c.type === 'orderBy') params.set('sortBy', c.field);
      else if (c.type === 'limit') params.set('pageSize', String(c.value));
    }
    const payload = await safeFetchJson(`/api/v1/attempts?${params.toString()}`);
    return wrapDocsResult((payload.data?.items || []).map((item: any) => ({ id: item.id, data: item.data })));
  }
  if (collectionName === 'schools' && constraints.length === 0) {
    const payload = await safeFetchJson('/api/v1/schools');
    return wrapDocsResult(payload.data || []);
  }
  if (collectionName === 'login_options' && constraints.length === 0) {
    const payload = await safeFetchJson('/api/v1/login-options');
    return wrapDocsResult(payload.data || []);
  }
  if (collectionName === 'questions' && constraints.length === 1 && isExactWhere(constraints[0], 'examId', '==')) {
    const payload = await safeFetchJson(`/api/v1/exams/${encodeURIComponent(constraints[0].value)}/questions`);
    return wrapDocsResult(payload.data || []);
  }
  if (collectionName === 'users' && constraints.length === 2) {
    const schoolIdC = constraints.find((c: any) => isExactWhere(c, 'schoolId', '=='));
    const roleC = constraints.find((c: any) => isExactWhere(c, 'role', '==', 'student'));
    if (schoolIdC && roleC) {
      const payload = await safeFetchJson(`/api/v1/schools/${encodeURIComponent(schoolIdC.value)}/students`);
      return wrapDocsResult(payload.data || []);
    }
  }
  return null;
}

// Core standard GET/READ single document
export async function getDoc(docRef: any) {
  const named = await tryNamedGetDoc(docRef);
  if (named) return named;

  const payload = await safeFetchJson('/api/db/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionName: docRef.collectionName,
      docId: docRef.id
    })
  });

  return wrapDocResult(docRef.id, payload.data);
}

// Core standard GET/READ query set
export async function getDocs(queryRef: any) {
  const collectionName = queryRef.collectionName;
  const constraints = queryRef.constraints || [];

  const named = await tryNamedGetDocs(collectionName, constraints);
  if (named) return named;

  const payload = await safeFetchJson('/api/db/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionName,
      constraints
    })
  });

  return wrapDocsResult(payload.data || []);
}

// Core standard ADD document write
export async function addDoc(collectionRef: any, data: any) {
  const payload = await safeFetchJson('/api/db/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'add',
      collectionName: collectionRef.collectionName,
      data
    })
  });

  dispatchDbWrite(collectionRef.collectionName, 'create', payload.id);
  return { id: payload.id };
}

// Core standard SET document write
export async function setDoc(docRef: any, data: any, options?: any) {
  await safeFetchJson('/api/db/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'set',
      collectionName: docRef.collectionName,
      docId: docRef.id,
      data,
      options
    })
  });

  dispatchDbWrite(docRef.collectionName, 'set', docRef.id);
  return { success: true };
}

// Core standard UPDATE document write
export async function updateDoc(docRef: any, data: any) {
  // Named-route fast path: the final exam-submission write (attempts + status:'completed')
  // goes through /submit specifically — that's the only path with the dup-submission lock
  // and server-side score recomputation. Every other attempts write falls to the PATCH
  // fast path just below instead.
  if (docRef.collectionName === 'attempts' && data && data.status === 'completed') {
    await safeFetchJson(`/api/v1/attempts/${encodeURIComponent(docRef.id)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    dispatchDbWrite(docRef.collectionName, 'update', docRef.id);
    return { success: true };
  }

  // Every other attempts write (autosave, timePerQuestion ticks, status:'in-progress',
  // proctoring/violation counts, canReattempt) — PATCH /api/v1/attempts/:id rejects
  // status:'completed' itself, so the fast path above always wins for that case.
  if (docRef.collectionName === 'attempts') {
    await safeFetchJson(`/api/v1/attempts/${encodeURIComponent(docRef.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    dispatchDbWrite(docRef.collectionName, 'update', docRef.id);
    return { success: true };
  }

  // Named-route fast path for user profile updates (e.g. Layout.tsx's school-context toggle).
  // Same authorizeWrite('update', 'users', ...) check either way — this just avoids the generic
  // proxy hop. See server/routes/v1/StudentController.ts's PATCH /api/v1/students/:studentId.
  if (docRef.collectionName === 'users') {
    await safeFetchJson(`/api/v1/students/${encodeURIComponent(docRef.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    dispatchDbWrite(docRef.collectionName, 'update', docRef.id);
    return { success: true };
  }

  await safeFetchJson('/api/db/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'update',
      collectionName: docRef.collectionName,
      docId: docRef.id,
      data
    })
  });

  dispatchDbWrite(docRef.collectionName, 'update', docRef.id);
  return { success: true };
}

// Core standard DELETE document
export async function deleteDoc(docRef: any) {
  // If exam or question, call custom specialized cleanup endpoints on backend
  if (docRef.collectionName === 'exams' || docRef.collectionName === 'questions') {
    await safeFetchJson(`/api/${docRef.collectionName}/${docRef.id}`, {
      method: 'DELETE'
    });
    dispatchDbWrite(docRef.collectionName, 'delete', docRef.id);
    return { success: true };
  }

  await safeFetchJson('/api/db/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'delete',
      collectionName: docRef.collectionName,
      docId: docRef.id
    })
  });

  dispatchDbWrite(docRef.collectionName, 'delete', docRef.id);
  return { success: true };
}

// Core standard GET count
export async function getCountFromServer(queryRef: any) {
  const collectionName = queryRef.collectionName;
  const constraints = queryRef.constraints || [];

  const payload = await safeFetchJson('/api/db/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionName,
      constraints,
      countOnly: true
    })
  });

  const count = payload.data?.count ?? 0;

  return {
    data: () => ({ count })
  };
}

// Core Real-Time subscription simulation (using standard polling interval abstraction)
export function onSnapshot(ref: any, callback: (snapshot: any) => void, errorCallback?: (error: any) => void) {
  let isUnsubscribed = false;
  let intervalId: any = null;

  const runQuery = async () => {
    try {
      if (ref.type === 'doc') {
        const snapshot = await getDoc(ref);
        if (!isUnsubscribed) callback(snapshot);
      } else {
        const snapshot = await getDocs(ref);
        if (!isUnsubscribed) callback(snapshot);
      }
    } catch (err: any) {
      const msg = (err?.message || String(err)).toLowerCase();
      const isTransient =
        msg.includes('failed to fetch') ||
        msg.includes('failed to connect') ||
        msg.includes('temporarily restarting') ||
        msg.includes('non-json response') ||
        msg.includes('html fallback') ||
        msg.includes('temporary html fallback') ||
        msg.includes('networkerror') ||
        msg.includes('aborted');

      if (isTransient) {
        // Log as low-severity warning during temporary server restarts / HMR reloads
        console.warn('[onSnapshot Polling Transient Notice (Self-recovering)]:', err.message || err);
      } else {
        console.error('[onSnapshot Polling Error]:', err);
        if (errorCallback && !isUnsubscribed) errorCallback(err);
      }
    }
  };

  // Run initial pull immediately
  runQuery();

  // Fine-tuned polling times per collection to conserve cloud credits. `attempts` in
  // particular is polled once per active exam-taker (their own attempt doc) — at up to
  // ~100k concurrent students, every second shaved off this interval is ~33k reads/sec of
  // difference, so this is the single biggest lever on read cost/scale for this app.
  const colName = ref.collectionName;
  let pollInterval = 6000; // Default: 6 seconds
  if (colName === 'attempts' || colName === 'proctor_logs' || colName === 'report_jobs') {
    pollInterval = 8000; // 8 seconds for active tests, exam answers, live proctoring
  } else if (colName === 'schools' || colName === 'syllabus' || colName === 'login_options') {
    pollInterval = 12000; // Slow: 12 seconds for lists that rarely change
  }

  intervalId = setInterval(runQuery, pollInterval);

  // Trigger immediate query execution when a local database write event is detected
  const handleDbWrite = () => {
    if (!isUnsubscribed) {
      runQuery();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('firestore-db-write', handleDbWrite);
  }

  return () => {
    isUnsubscribed = true;
    if (intervalId) clearInterval(intervalId);
    if (typeof window !== 'undefined') {
      window.removeEventListener('firestore-db-write', handleDbWrite);
    }
  };
}
