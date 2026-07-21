/**
 * Centralized API Service Layer
 * Replaces direct client-side Firestore SDK queries with standard fetch API requests
 * routing through the cushioned, cached Node.js Node Server.
 * Supports exact drop-in function signatures to ensure zero frontend disruption.
 */

import { GlobalDbSubject, CrudType } from './observerPattern';

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
async function safeFetchJson(url: string, options: RequestInit = {}) {
  try {
    const res = await fetch(url, options);
    
    if (!res.ok) {
      const status = res.status;
      if ([400, 401, 403, 404, 500].includes(status)) {
        const event = new CustomEvent('global-http-error', { 
          detail: { status, url } 
        });
        window.dispatchEvent(event);
      }
    }
    
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(`Server returned non-JSON response (status ${res.status}, content-type: ${contentType || 'none'}). This is likely a temporary HTML fallback during server startup or reload.`);
    }

    const payload = await res.json();
    
    if (!res.ok) {
      throw new Error(payload.error || `HTTP error! status: ${res.status}`);
    }
    
    return payload;
  } catch (err: any) {
    if (err instanceof TypeError && err.message === 'Failed to fetch') {
      // Check offline status
      if (!navigator.onLine) {
        const event = new CustomEvent('global-http-error', { 
          detail: { status: 'offline' } 
        });
        window.dispatchEvent(event);
      }
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

  const result = await updateFunction(transactionProxy);

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
  return result;
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

// Core standard GET/READ single document
export async function getDoc(docRef: any) {
  const payload = await safeFetchJson('/api/db/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionName: docRef.collectionName,
      docId: docRef.id
    })
  });

  const docData = payload.data;

  return {
    id: docRef.id,
    exists: () => !!docData?.exists,
    data: () => docData?.data || null
  };
}

// Core standard GET/READ query set
export async function getDocs(queryRef: any) {
  const collectionName = queryRef.collectionName;
  const constraints = queryRef.constraints || [];

  const payload = await safeFetchJson('/api/db/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionName,
      constraints
    })
  });

  const rawDocs = payload.data || [];

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
export function onSnapshot(
  ref: any,
  callback: (snapshot: any) => void,
  errorCallback?: (error: any) => void
) {
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
      const isTransient = msg.includes('failed to fetch') || 
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

  // Fine-tuned polling times per collection to conserve cloud credits
  const colName = ref.collectionName;
  let pollInterval = 6000; // Default: 6 seconds
  if (colName === 'attempts' || colName === 'proctor_logs' || colName === 'report_jobs') {
    pollInterval = 3000; // Fast: 3 seconds for active tests, exam answers, live proctoring
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
