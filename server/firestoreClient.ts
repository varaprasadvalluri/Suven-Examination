import { GoogleAuth } from 'google-auth-library';
import { firebaseConfig } from './config';
import { createBreaker } from './lib/circuitBreaker';
import { withRetry, FirestoreRestError } from './lib/retry';

// A handle identifying WHICH Firestore database a ref belongs to. The default handle
// (`clientDb`) carries no overrides and therefore resolves to this app's own configured
// project/database — byte-identical to the URLs this client built before handles existed.
//
// Overrides exist for exactly one caller: the admin migration route (routes/adminDb.ts), which
// has to READ from a different project's database and write into this one. Without this, refs
// carried no database identity at all, so `clientCollection(sourceDb, ...)` silently ignored
// its first argument and read the destination — a migration that would have copied the
// destination onto itself.
export interface DatabaseHandle {
  type: 'db';
  projectId?: string;
  databaseId?: string;
  apiKey?: string;
}

export function createDatabaseHandle(config: { projectId: string; firestoreDatabaseId?: string; apiKey: string }): DatabaseHandle {
  return {
    type: 'db',
    projectId: config.projectId,
    databaseId: config.firestoreDatabaseId || '(default)',
    apiKey: config.apiKey
  };
}

// REST Client configuration
export const getBaseUrl = (db?: DatabaseHandle) => {
  const projectId = db?.projectId || firebaseConfig.projectId;
  const databaseId = db?.databaseId || firebaseConfig.firestoreDatabaseId;
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
};

function apiKeyFor(db?: DatabaseHandle): string {
  return db?.apiKey || firebaseConfig.apiKey;
}

// Exported for direct reuse by the GCP billing/IAM routes, which use the same ADC client
// and auto-detected project ID outside of Firestore REST calls.
export const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/cloud-platform']
});

export let detectedContainerProjectId: string | null = null;
let cachedToken: { token: string; expiry: number } | null = null;

export async function getAuthHeader(db?: DatabaseHandle): Promise<Record<string, string>> {
  // A ref pointing at a DIFFERENT project than this app's own never gets this app's ADC
  // token — that credential isn't valid there, and attaching it would mask the real 403 with
  // a confusing auth error. Such reads authenticate with the source config's own apiKey.
  if (db?.projectId && db.projectId !== firebaseConfig.projectId) {
    return {};
  }
  if (!detectedContainerProjectId) {
    try {
      detectedContainerProjectId = await auth.getProjectId();
      console.log(`[Firestore Auth] Auto-detected container project ID: "${detectedContainerProjectId}"`);
    } catch (err) {
      console.warn('[Firestore Auth] Could not auto-detect container project ID:', err);
    }
  }

  // Use Application Default Credentials (ADC) if we are targeting the platform's sandbox project and using the default database.
  // Standard platforms projects have IDs starting with 'gen-lang-client-' or 'project-'.
  // We also use ADC if the target project matches the auto-detected container project ID and we use the (default) database.
  const isTargetingPlatformProject =
    (firebaseConfig.projectId === 'gen-lang-client-0086284509' ||
      firebaseConfig.projectId.startsWith('gen-lang-client-') ||
      firebaseConfig.projectId.startsWith('project-') ||
      !!(detectedContainerProjectId && firebaseConfig.projectId === detectedContainerProjectId)) &&
    (!firebaseConfig.firestoreDatabaseId || firebaseConfig.firestoreDatabaseId === '(default)');

  if (!isTargetingPlatformProject) {
    return {};
  }
  try {
    if (cachedToken && cachedToken.expiry > Date.now() + 300000) {
      return { Authorization: `Bearer ${cachedToken.token}` };
    }
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (tokenResponse.token) {
      cachedToken = {
        token: tokenResponse.token,
        expiry: Date.now() + 3000000 // Cached for 50 minutes
      };
      return { Authorization: `Bearer ${tokenResponse.token}` };
    }
  } catch (err) {
    console.warn('[Firestore Auth] Failed to get Application Default Credentials token, falling back to apiKey:', err);
  }
  return {};
}

console.log(`[NODE EXPRESS SERVER] Routed safely via Firestore REST API Gateway to DB: "${firebaseConfig.firestoreDatabaseId}"`);

// The default handle: no overrides, so every ref built from it resolves to this app's own
// configured project and database exactly as before.
export const clientDb: DatabaseHandle = { type: 'db' };

// Firestore REST Type Marshallers and Parsers
export function fromFirestoreValue(val: any): any {
  if (!val) return null;
  const keys = Object.keys(val);
  if (keys.length === 0) return null;
  const type = keys[0];
  const value = val[type];
  if (type === 'mapValue') {
    return fromFirestoreFields(value.fields || {});
  }
  if (type === 'arrayValue') {
    const values = value.values || [];
    return values.map((v: any) => fromFirestoreValue(v));
  }
  if (type === 'integerValue') {
    return parseInt(value, 10);
  }
  if (type === 'doubleValue') {
    return parseFloat(value);
  }
  if (type === 'booleanValue') {
    return value === true || value === 'true';
  }
  if (type === 'nullValue') {
    return null;
  }
  return value;
}

export function fromFirestoreFields(fields: any): any {
  const result: any = {};
  if (!fields) return result;
  for (const key of Object.keys(fields)) {
    result[key] = fromFirestoreValue(fields[key]);
  }
  return result;
}

export function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: val.toString() };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((v) => toFirestoreValue(v))
      }
    };
  }
  if (typeof val === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields(val)
      }
    };
  }
  return { stringValue: String(val) };
}

export function toFirestoreFields(obj: any): any {
  const fields: any = {};
  if (!obj) return fields;
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      fields[key] = toFirestoreValue(obj[key]);
    }
  }
  return fields;
}

export function buildUpdateMaskParams(data: any): string {
  if (!data) return '';
  const keys = Object.keys(data);
  return keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
}

export function parseCollectionPath(path: string) {
  const parts = path.split('/');
  if (parts.length === 1) {
    return {
      parentPath: '',
      collectionId: parts[0]
    };
  }
  const collectionId = parts[parts.length - 1];
  const parentPath = parts.slice(0, parts.length - 1).join('/');
  return {
    parentPath,
    collectionId
  };
}

export function mapOp(op: string): string {
  switch (op) {
    case '<':
      return 'LESS_THAN';
    case '<=':
      return 'LESS_THAN_OR_EQUAL';
    case '>':
      return 'GREATER_THAN';
    case '>=':
      return 'GREATER_THAN_OR_EQUAL';
    case '==':
      return 'EQUAL';
    case '!=':
      return 'NOT_EQUAL';
    case 'array-contains':
      return 'ARRAY_CONTAINS';
    case 'in':
      return 'IN';
    case 'array-contains-any':
      return 'ARRAY_CONTAINS_ANY';
    case 'not-in':
      return 'NOT_IN';
    default:
      return 'EQUAL';
  }
}

// --- REST CLIENT WRAPPERS FOR COMPATIBILITY ---

export function clientCollection(parent: any, collectionName: string) {
  // A subcollection inherits its parent doc's database; a top-level collection takes the
  // database from the handle it was opened against (clientDb by default).
  if (parent && parent.type === 'doc') {
    return { type: 'collection', collectionName: `${parent.collectionName}/${parent.id}/${collectionName}`, db: parent.db };
  }
  return { type: 'collection', collectionName, db: parent && parent.type === 'db' ? parent : undefined };
}

export function clientDoc(...args: any[]) {
  if (args.length === 3) {
    const dbHandle = args[0];
    const colName = args[1];
    const id = args[2];
    return { type: 'doc', collectionName: colName, id, db: dbHandle && dbHandle.type === 'db' ? dbHandle : undefined };
  } else if (args.length === 2) {
    const parent = args[0];
    const id = args[1];
    if (parent && parent.type === 'collection') {
      return { type: 'doc', collectionName: parent.collectionName, id, db: parent.db };
    }
    if (typeof parent === 'string') {
      return { type: 'doc', collectionName: parent, id };
    }
    if (parent && parent.collectionName) {
      return { type: 'doc', collectionName: parent.collectionName, id };
    }
  }
  throw new Error('[Client Wrapper doc] Unsupported argument combination.');
}

async function clientGetDocImpl(docRef: any) {
  const url = `${getBaseUrl(docRef.db)}/${docRef.collectionName}/${docRef.id}?key=${apiKeyFor(docRef.db)}`;
  try {
    const headers: Record<string, string> = {};
    const authHeader = await getAuthHeader(docRef.db);
    Object.assign(headers, authHeader);

    const httpResponse = await fetch(url, { headers });
    if (httpResponse.status === 404) {
      return {
        id: docRef.id,
        exists: () => false,
        data: (): any => null
      };
    }
    if (!httpResponse.ok) {
      const errText = await httpResponse.text();
      throw new FirestoreRestError(httpResponse.status, `Firestore REST error: ${httpResponse.status} ${errText}`);
    }
    const payload = await httpResponse.json();
    const docData = fromFirestoreFields(payload.fields || {});
    return {
      id: docRef.id,
      exists: () => true,
      data: () => docData
    };
  } catch (err: any) {
    console.error(`Error in clientGetDoc for ${docRef.collectionName}/${docRef.id}:`, err);
    throw err;
  }
}

async function clientGetDocsImpl(queryRef: any) {
  const collectionName = queryRef.collectionName;
  const constraints = queryRef.constraints || [];

  const { parentPath, collectionId } = parseCollectionPath(collectionName);
  const urlPath = parentPath ? `/${parentPath}:runQuery` : ':runQuery';
  const url = `${getBaseUrl(queryRef.db)}${urlPath}?key=${apiKeyFor(queryRef.db)}`;

  const structuredQuery: any = {
    from: [{ collectionId }]
  };

  const whereConstraints = constraints.filter((constraint: any) => constraint.type === 'where');
  const orderByConstraints = constraints.filter((constraint: any) => constraint.type === 'orderBy');
  const limitConstraints = constraints.filter((constraint: any) => constraint.type === 'limit');
  const startAfterConstraints = constraints.filter((constraint: any) => constraint.type === 'startAfter');

  if (whereConstraints.length > 0) {
    const filters = whereConstraints.map((constraint: any) => {
      return {
        fieldFilter: {
          field: { fieldPath: constraint.field },
          op: mapOp(constraint.op),
          value: toFirestoreValue(constraint.value)
        }
      };
    });

    if (filters.length === 1) {
      structuredQuery.where = filters[0];
    } else {
      structuredQuery.where = {
        compositeFilter: {
          op: 'AND',
          filters
        }
      };
    }
  }

  if (orderByConstraints.length > 0) {
    structuredQuery.orderBy = orderByConstraints.map((constraint: any) => ({
      field: { fieldPath: constraint.field },
      direction: constraint.direction === 'desc' ? 'DESCENDING' : 'ASCENDING'
    }));
  }

  const hasStartAfter = startAfterConstraints.length > 0;
  if (limitConstraints.length > 0 && !hasStartAfter) {
    structuredQuery.limit = limitConstraints[0].limit;
  }

  const offsetConstraints = constraints.filter((constraint: any) => constraint.type === 'offset');
  if (offsetConstraints.length > 0 && !hasStartAfter) {
    structuredQuery.offset = offsetConstraints[0].offset;
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authHeader = await getAuthHeader();
    Object.assign(headers, authHeader);

    const httpResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ structuredQuery })
    });

    if (!httpResponse.ok) {
      const errText = await httpResponse.text();
      throw new FirestoreRestError(httpResponse.status, `Firestore REST runQuery error: ${httpResponse.status} ${errText}`);
    }

    const payload = await httpResponse.json();
    let rawDocs = (payload || [])
      .filter((item: any) => item && item.document)
      .map((item: any) => {
        const doc = item.document;
        const docId = doc.name.split('/').pop();
        const docData = fromFirestoreFields(doc.fields || {});
        return {
          id: docId,
          exists: () => true,
          data: () => docData
        };
      });

    if (hasStartAfter) {
      const startAfterId = startAfterConstraints[0].startAfter?.id || startAfterConstraints[0].startAfter;
      if (startAfterId) {
        const index = rawDocs.findIndex((d: any) => d.id === startAfterId);
        if (index !== -1) {
          rawDocs = rawDocs.slice(index + 1);
        }
      }

      if (limitConstraints.length > 0) {
        rawDocs = rawDocs.slice(0, limitConstraints[0].limit);
      }
    }

    return {
      docs: rawDocs,
      empty: rawDocs.length === 0,
      size: rawDocs.length,
      forEach: (cb: (doc: any) => void) => rawDocs.forEach(cb)
    };
  } catch (err: any) {
    console.error(`Error in clientGetDocs for ${collectionName}:`, err);
    throw err;
  }
}

async function clientSetDocImpl(docRef: any, data: any, options?: any) {
  let url = `${getBaseUrl()}/${docRef.collectionName}/${docRef.id}?key=${firebaseConfig.apiKey}`;
  if (options && options.merge) {
    const params = buildUpdateMaskParams(data);
    if (params) {
      url += `&${params}`;
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authHeader = await getAuthHeader();
  Object.assign(headers, authHeader);

  const httpResponse = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  if (!httpResponse.ok) {
    const errText = await httpResponse.text();
    throw new FirestoreRestError(httpResponse.status, `Firestore REST setDoc error: ${httpResponse.status} ${errText}`);
  }

  return { success: true };
}

async function clientUpdateDocImpl(docRef: any, data: any) {
  let url = `${getBaseUrl()}/${docRef.collectionName}/${docRef.id}?key=${firebaseConfig.apiKey}`;
  const params = buildUpdateMaskParams(data);
  if (params) {
    url += `&${params}`;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authHeader = await getAuthHeader();
  Object.assign(headers, authHeader);

  const httpResponse = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  if (!httpResponse.ok) {
    const errText = await httpResponse.text();
    throw new FirestoreRestError(httpResponse.status, `Firestore REST updateDoc error: ${httpResponse.status} ${errText}`);
  }

  return { success: true };
}

async function clientDeleteDocImpl(docRef: any) {
  const url = `${getBaseUrl()}/${docRef.collectionName}/${docRef.id}?key=${firebaseConfig.apiKey}`;

  const headers: Record<string, string> = {};
  const authHeader = await getAuthHeader();
  Object.assign(headers, authHeader);

  const httpResponse = await fetch(url, {
    method: 'DELETE',
    headers
  });

  if (!httpResponse.ok && httpResponse.status !== 404) {
    const errText = await httpResponse.text();
    throw new FirestoreRestError(httpResponse.status, `Firestore REST deleteDoc error: ${httpResponse.status} ${errText}`);
  }

  return { success: true };
}

async function clientAddDocImpl(collectionRef: any, data: any) {
  const url = `${getBaseUrl()}/${collectionRef.collectionName}?key=${firebaseConfig.apiKey}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authHeader = await getAuthHeader();
  Object.assign(headers, authHeader);

  const httpResponse = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  if (!httpResponse.ok) {
    const errText = await httpResponse.text();
    throw new FirestoreRestError(httpResponse.status, `Firestore REST addDoc error: ${httpResponse.status} ${errText}`);
  }

  const payload = await httpResponse.json();
  const id = payload.name.split('/').pop();
  return { id };
}

// Circuit-breaker-wrapped entry points — every caller across the server (gatekeeper,
// exams, db, reports, adminDb routes) imports these same names, so wrapping here protects
// all Firestore REST access in one place without touching call sites.
//
// Retry sits INSIDE the breaker (see server/lib/retry.ts): a call that fails once on a
// transient 429/503 and succeeds on the retry is reported to the breaker as a success, so
// ordinary Firestore contention no longer counts toward tripping it.
//
// clientAddDoc is deliberately NOT retried. It POSTs to the collection and lets Firestore
// assign the document ID, so it is not idempotent — retrying a request that actually
// succeeded but whose response was lost would create a second, duplicate document instead of
// converging on the first. It keeps the breaker only.
export const clientGetDoc = createBreaker('firestore.getDoc', withRetry('firestore.getDoc', clientGetDocImpl));
export const clientGetDocs = createBreaker('firestore.getDocs', withRetry('firestore.getDocs', clientGetDocsImpl));
export const clientSetDoc = createBreaker('firestore.setDoc', withRetry('firestore.setDoc', clientSetDocImpl));
export const clientUpdateDoc = createBreaker('firestore.updateDoc', withRetry('firestore.updateDoc', clientUpdateDocImpl));
export const clientDeleteDoc = createBreaker('firestore.deleteDoc', withRetry('firestore.deleteDoc', clientDeleteDocImpl));
export const clientAddDoc = createBreaker('firestore.addDoc', clientAddDocImpl);

export interface QueryConstraint {
  type: string;
  field?: string;
  op?: string;
  value?: any;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  startAfter?: any;
}

export function clientWhere(field: string, op: any, value: any): QueryConstraint {
  return { type: 'where', field, op, value };
}

export function clientLimit(value: number): QueryConstraint {
  return { type: 'limit', limit: value };
}

export function clientOrderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint {
  return { type: 'orderBy', field, direction };
}

// Skips the first N matching documents inside Firestore, so page N of a list can be served
// without shipping pages 1..N-1 to this process. NOTE Firestore still BILLS the skipped
// documents as reads, so offset is a large win on transfer, parsing and memory but only a
// partial win on cost — deep pages stay proportionally expensive. Cursor pagination is the
// only shape that avoids that entirely; see FirestoreAttemptDao.findByFilters.
export function clientOffset(value: number): QueryConstraint {
  return { type: 'offset', offset: value };
}

export function clientStartAfter(docSnapshot: any): QueryConstraint {
  return { type: 'startAfter', startAfter: docSnapshot };
}

export function clientQuery(...args: any[]) {
  if (args.length === 0) return null;
  const collectionRef = args[0];
  const constraints: any[] = [];
  for (let i = 1; i < args.length; i++) {
    const constraint = args[i];
    if (constraint) constraints.push(constraint);
  }
  return {
    type: 'query',
    collectionName: collectionRef.collectionName,
    constraints,
    db: collectionRef.db
  };
}

export function clientWriteBatch(dbInstance: any) {
  const operations: any[] = [];
  return {
    set: (docRef: any, data: any, options?: any) => {
      operations.push({ type: 'set', docRef, data, options });
    },
    update: (docRef: any, data: any) => {
      operations.push({ type: 'update', docRef, data });
    },
    delete: (docRef: any) => {
      operations.push({ type: 'delete', docRef });
    },
    commit: async () => {
      for (const op of operations) {
        if (op.type === 'set') {
          await clientSetDoc(op.docRef, op.data, op.options);
        } else if (op.type === 'update') {
          await clientUpdateDoc(op.docRef, op.data);
        } else if (op.type === 'delete') {
          await clientDeleteDoc(op.docRef);
        }
      }
    }
  };
}

// Real server-side COUNT via Firestore's aggregation endpoint.
//
// This used to run the full query and return `snap.docs.length` — i.e. it read and parsed every
// matching document just to produce a number, which is the most expensive possible way to count
// and exactly what a caller reaching for a count is trying to avoid. runAggregationQuery does
// the counting inside Firestore and returns a single scalar, billed at roughly one read per
// 1,000 documents matched instead of one per document.
//
// Falls back to the old count-by-fetching path if the aggregation call fails, so a deployment
// where the endpoint is unavailable keeps working rather than breaking a dashboard.
export async function clientGetCountFromServer(queryRef: any) {
  const collectionName = queryRef.collectionName;
  const constraints = (queryRef.constraints || []).filter((constraint: any) => constraint.type === 'where');
  const { parentPath, collectionId } = parseCollectionPath(collectionName);
  const urlPath = parentPath ? `/${parentPath}:runAggregationQuery` : ':runAggregationQuery';
  const url = `${getBaseUrl(queryRef.db)}${urlPath}?key=${apiKeyFor(queryRef.db)}`;

  const structuredQuery: any = { from: [{ collectionId }] };
  if (constraints.length > 0) {
    const filters = constraints.map((constraint: any) => ({
      fieldFilter: {
        field: { fieldPath: constraint.field },
        op: mapOp(constraint.op),
        value: toFirestoreValue(constraint.value)
      }
    }));
    structuredQuery.where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    Object.assign(headers, await getAuthHeader(queryRef.db));

    const httpResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredAggregationQuery: {
          structuredQuery,
          aggregations: [{ count: {}, alias: 'total' }]
        }
      })
    });

    if (!httpResponse.ok) {
      throw new FirestoreRestError(httpResponse.status, `Firestore REST count error: ${httpResponse.status} ${await httpResponse.text()}`);
    }

    const payload = await httpResponse.json();
    const rows = Array.isArray(payload) ? payload : [payload];
    const raw = rows.find((row: any) => row?.result?.aggregateFields?.total)?.result?.aggregateFields?.total;
    const count = raw ? parseInt(raw.integerValue ?? raw.doubleValue ?? '0', 10) : 0;
    return { data: () => ({ count }) };
  } catch (err) {
    console.warn('[Firestore] Aggregation count failed, falling back to counting by fetch:', err);
    const snap = await clientGetDocs(queryRef);
    return { data: () => ({ count: snap.docs.length }) };
  }
}

export async function clientRunTransaction(dbInstance: any, updateFunction: (transaction: any) => Promise<any>) {
  const operations: any[] = [];
  const transactionProxy = {
    get: async (docRef: any) => {
      return await clientGetDoc(docRef);
    },
    set: (docRef: any, data: any, options?: any) => {
      operations.push({ type: 'set', docRef, data, options });
    },
    update: (docRef: any, data: any) => {
      operations.push({ type: 'update', docRef, data });
    },
    delete: (docRef: any) => {
      operations.push({ type: 'delete', docRef });
    }
  };

  const transactionResult = await updateFunction(transactionProxy);

  for (const op of operations) {
    if (op.type === 'set') {
      await clientSetDoc(op.docRef, op.data, op.options);
    } else if (op.type === 'update') {
      await clientUpdateDoc(op.docRef, op.data);
    } else if (op.type === 'delete') {
      await clientDeleteDoc(op.docRef);
    }
  }

  return transactionResult;
}
