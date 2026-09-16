import { GoogleAuth } from 'google-auth-library';
import { firebaseConfig, firestoreEmulatorHost, isFirestoreEmulated } from '../../../config';
import { createBreaker } from '../../../lib/circuitBreaker';
import { withRetry, FirestoreRestError } from '../../../lib/retry';
import { logger } from '../../../lib/logger';

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

// Where Firestore's REST API lives: the real service, or the local emulator when
// FIRESTORE_EMULATOR_HOST is set. The emulator serves the identical v1 REST surface, so the
// only difference is the origin — every path, body and response shape below is unchanged.
const firestoreOrigin = () => (isFirestoreEmulated ? `http://${firestoreEmulatorHost}` : 'https://firestore.googleapis.com');

// REST Client configuration
export const getBaseUrl = (db?: DatabaseHandle) => {
  const projectId = db?.projectId || firebaseConfig.projectId;
  const databaseId = db?.databaseId || firebaseConfig.firestoreDatabaseId;
  return `${firestoreOrigin()}/v1/projects/${projectId}/databases/${databaseId}/documents`;
};

function apiKeyFor(db?: DatabaseHandle): string {
  return db?.apiKey || firebaseConfig.apiKey;
}

// The Firestore RESOURCE NAME prefix for a database, as opposed to getBaseUrl's HTTPS URL.
// The batch-commit and transaction endpoints below identify documents by resource name
// (`projects/p/databases/d/documents/collection/id`) inside the request body, not by URL path.
export const getDocumentsPath = (db?: DatabaseHandle) => {
  const projectId = db?.projectId || firebaseConfig.projectId;
  const databaseId = db?.databaseId || firebaseConfig.firestoreDatabaseId;
  return `projects/${projectId}/databases/${databaseId}/documents`;
};

// Exported for direct reuse by the GCP billing/IAM routes, which use the same ADC client
// and auto-detected project ID outside of Firestore REST calls.
export const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/cloud-platform']
});

export let detectedContainerProjectId: string | null = null;
let cachedToken: { token: string; expiry: number } | null = null;

// NEGATIVE caching for credential lookups, so an environment WITHOUT Application Default
// Credentials costs one probe rather than one per Firestore call.
//
// google-auth-library resolves credentials by looking for an env var, then a well-known file,
// then by asking the GCE metadata server — and that last step is a network call to a link-local
// address that simply times out on a developer laptop. Without a memo of the failure, every
// single Firestore read pays that timeout, retry wraps it, and the circuit breaker in front
// eventually opens: the app stops showing data at all, for want of a credential it was only
// ever going to fall back from. Successes are already cached (`cachedToken`); this is the other
// half of the same idea.
//
// A cooldown rather than a permanent flag: credentials can legitimately appear after the
// process starts (someone runs `gcloud auth application-default login` and expects the running
// server to pick it up), and on Cloud Run a metadata blip must not disable ADC for the life of
// the instance.
const CREDENTIAL_PROBE_COOLDOWN_MS = 60000;
let projectProbeBlockedUntil = 0;
let adcProbeBlockedUntil = 0;

// Exported for tests, which need each case to start from an un-probed state.
export function __resetCredentialProbeState(): void {
  detectedContainerProjectId = null;
  cachedToken = null;
  projectProbeBlockedUntil = 0;
  adcProbeBlockedUntil = 0;
}

export async function getAuthHeader(db?: DatabaseHandle): Promise<Record<string, string>> {
  // The emulator recognises the literal token `owner` as a full-access caller, which is what
  // lets it serve transactions — and every other operation — with no real credentials. Returned
  // before any of the ADC machinery below so local development never waits on a metadata-server
  // lookup that was always going to fail.
  if (isFirestoreEmulated) {
    return { Authorization: 'Bearer owner' };
  }

  // A ref pointing at a DIFFERENT project than this app's own never gets this app's ADC
  // token — that credential isn't valid there, and attaching it would mask the real 403 with
  // a confusing auth error. Such reads authenticate with the source config's own apiKey.
  if (db?.projectId && db.projectId !== firebaseConfig.projectId) {
    return {};
  }
  // Detected for its own sake, not to decide anything about authentication: the GCP
  // billing/IAM routes (routes/gcp.ts) read it to know which project they are running in.
  if (!detectedContainerProjectId && Date.now() >= projectProbeBlockedUntil) {
    try {
      detectedContainerProjectId = await auth.getProjectId();
      logger.info('Firestore auth: auto-detected container project ID', { detectedContainerProjectId });
    } catch (err) {
      // Off-platform (a developer machine) this fails every time and costs a metadata-server
      // timeout, so it is not re-asked on the next call — see CREDENTIAL_PROBE_COOLDOWN_MS.
      projectProbeBlockedUntil = Date.now() + CREDENTIAL_PROBE_COOLDOWN_MS;
      logger.warn('Firestore auth: could not auto-detect container project ID, pausing detection', { err });
    }
  }

  // ONE mechanism for every environment. Application Default Credentials exist precisely so
  // that the same call resolves to the right identity wherever the process runs: the service
  // account from the metadata server on Cloud Run, the file written by
  // `gcloud auth application-default login` on a developer machine, or GOOGLE_APPLICATION_
  // CREDENTIALS wherever that is set. So the rule here is simply: ask for a token, and use it
  // if there is one. No environment detection, because there is nothing to detect.
  //
  // This used to guess instead, from two things that say nothing about whether credentials
  // exist:
  //   - the project NAME (`startsWith('project-')`, `startsWith('gen-lang-client-')`), which
  //     means renaming the project silently turns authentication off;
  //   - the DATABASE id, requiring `(default)` — and this app's is `suven-edu`, so ADC was
  //     disabled everywhere, Cloud Run included. Plain document reads and writes survive on the
  //     Firebase API key alone and hid it; `:beginTransaction` does not, and answers 403
  //     PERMISSION_DENIED. The one code path built on a real transaction is exam-entry
  //     enrollment (gatekeeper.ts), so the whole app looked healthy and a student could get all
  //     the way to the start-exam button before anything failed.
  //
  // Falling back to the API key when no credentials are found keeps local read-only work
  // possible without a login, which is the one genuine convenience the old branching bought.
  if (cachedToken && cachedToken.expiry > Date.now() + 300000) {
    return { Authorization: `Bearer ${cachedToken.token}` };
  }
  // A recent probe already established there are no credentials here. Fall back to the API key
  // immediately instead of waiting on the same lookup again — the whole point is that this path
  // runs in front of EVERY Firestore call.
  if (Date.now() < adcProbeBlockedUntil) {
    return {};
  }
  try {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (tokenResponse.token) {
      cachedToken = {
        token: tokenResponse.token,
        expiry: Date.now() + 3000000 // Cached for 50 minutes
      };
      return { Authorization: `Bearer ${tokenResponse.token}` };
    }
    // Resolved, but handed back no token. Same cost to re-ask as a throw, so same cooldown.
    adcProbeBlockedUntil = Date.now() + CREDENTIAL_PROBE_COOLDOWN_MS;
  } catch (err) {
    adcProbeBlockedUntil = Date.now() + CREDENTIAL_PROBE_COOLDOWN_MS;
    logger.warn('Firestore auth: ADC token unavailable, falling back to apiKey', { err });
  }
  return {};
}

// Every REST call below repeated the same two rituals: build a header bag, await the auth
// header, Object.assign it in; then, on the way back, check `ok`, read the body as text and
// throw a FirestoreRestError naming the operation. Eleven copies of the first and ten of the
// second. These two helpers are deliberately separate rather than one fetch wrapper, because
// two call sites legitimately break the pattern: getDoc treats 404 as "does not exist" rather
// than an error, and the transaction rollback is fire-and-forget.
async function firestoreHeaders(db?: DatabaseHandle, hasJsonBody = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = hasJsonBody ? { 'Content-Type': 'application/json' } : {};
  Object.assign(headers, await getAuthHeader(db));
  return headers;
}

async function assertFirestoreOk(httpResponse: Response, operation?: string): Promise<void> {
  if (httpResponse.ok) return;
  const errText = await httpResponse.text();
  const label = operation ? `Firestore REST ${operation} error` : 'Firestore REST error';
  throw new FirestoreRestError(httpResponse.status, `${label}: ${httpResponse.status} ${errText}`);
}

logger.info('Firestore REST gateway ready', { database: firebaseConfig.firestoreDatabaseId });

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
    const headers = await firestoreHeaders(docRef.db);

    const httpResponse = await fetch(url, { headers });
    if (httpResponse.status === 404) {
      return {
        id: docRef.id,
        exists: () => false,
        data: (): any => null
      };
    }
    await assertFirestoreOk(httpResponse);
    const payload = await httpResponse.json();
    const docData = fromFirestoreFields(payload.fields || {});
    return {
      id: docRef.id,
      exists: () => true,
      data: () => docData
    };
  } catch (err: any) {
    logger.error('clientGetDoc failed', { collection: docRef.collectionName, docId: docRef.id, err });
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

  // PROJECTION. Firestore still bills a read per document, but it only SENDS the named fields
  // — which is the difference between a bounded response and an unbounded one when the
  // documents carry big arrays. An `attempts` document holds the student's whole `answers[]`;
  // a report that wants score and studentId does not want to transfer, parse and hold 100
  // answer objects per row to get them.
  const selectConstraint = constraints.find((constraint: any) => constraint.type === 'select');
  if (selectConstraint && selectConstraint.fields?.length) {
    structuredQuery.select = { fields: selectConstraint.fields.map((fieldPath: string) => ({ fieldPath })) };
  }

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

  // REAL cursor pagination, not a client-side slice.
  //
  // A startAfter used to suppress the server-side `limit` entirely and then locate the cursor
  // by scanning the parsed response for its id. Firestore was therefore asked for the WHOLE
  // collection on every page: clicking page 2 of the student list on a 100k-student platform
  // read 100,000 documents to display ten of them, and the cost grew with the tenant rather
  // than with the page size. `startAt` moves that into the query, where paging is O(page).
  //
  // Cursor values line up positionally with orderBy, and Firestore orders by __name__ last
  // whether or not you say so — making it explicit is what keeps the cursor unambiguous
  // between documents that share a sort value (two students with the same name would otherwise
  // page erratically).
  const hasStartAfter = startAfterConstraints.length > 0;
  let usedServerCursor = false;

  if (hasStartAfter) {
    const cursor = startAfterConstraints[0].startAfter;
    const cursorId = cursor?.id || (typeof cursor === 'string' ? cursor : undefined);
    const cursorData = typeof cursor?.data === 'function' ? cursor.data() : undefined;

    if (cursorId && cursorData) {
      const lastDirection = orderByConstraints[orderByConstraints.length - 1]?.direction === 'desc' ? 'DESCENDING' : 'ASCENDING';
      structuredQuery.orderBy = [...(structuredQuery.orderBy || []), { field: { fieldPath: '__name__' }, direction: lastDirection }];
      structuredQuery.startAt = {
        values: [
          ...orderByConstraints.map((constraint: any) => toFirestoreValue(cursorData[constraint.field])),
          { referenceValue: `${getDocumentsPath(queryRef.db)}/${collectionName}/${cursorId}` }
        ],
        before: false
      };
      usedServerCursor = true;
    }
  }

  // The limit is only withheld when the cursor could NOT be pushed into the query — in that
  // case the old in-memory slice below still needs the surrounding documents to find the
  // cursor in. That fallback keeps a caller passing a bare document id (rather than a
  // snapshot) working exactly as before.
  if (limitConstraints.length > 0 && (!hasStartAfter || usedServerCursor)) {
    structuredQuery.limit = limitConstraints[0].limit;
  }

  const offsetConstraints = constraints.filter((constraint: any) => constraint.type === 'offset');
  if (offsetConstraints.length > 0 && !hasStartAfter) {
    structuredQuery.offset = offsetConstraints[0].offset;
  }

  try {
    // queryRef.db, not the default handle. A query against another project resolved its URL
    // from the ref but its credentials from this app, so a cross-project read (the admin
    // migration route's only job) went out with a token that project would reject — surfacing
    // as an auth error rather than the missing-permission it actually is. getAuthHeader
    // already returns no header for a foreign project; it just was not being told about one.
    const headers = await firestoreHeaders(queryRef.db, true);

    const httpResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ structuredQuery })
    });

    await assertFirestoreOk(httpResponse, 'runQuery');

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

    if (hasStartAfter && !usedServerCursor) {
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
    logger.error('clientGetDocs failed', { collection: collectionName, err });
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

  const headers = await firestoreHeaders(undefined, true);

  const httpResponse = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  await assertFirestoreOk(httpResponse, 'setDoc');

  return { success: true };
}

async function clientUpdateDocImpl(docRef: any, data: any) {
  let url = `${getBaseUrl()}/${docRef.collectionName}/${docRef.id}?key=${firebaseConfig.apiKey}`;
  const params = buildUpdateMaskParams(data);
  if (params) {
    url += `&${params}`;
  }

  const headers = await firestoreHeaders(undefined, true);

  const httpResponse = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  await assertFirestoreOk(httpResponse, 'updateDoc');

  return { success: true };
}

async function clientDeleteDocImpl(docRef: any) {
  const url = `${getBaseUrl()}/${docRef.collectionName}/${docRef.id}?key=${firebaseConfig.apiKey}`;

  const headers = await firestoreHeaders();

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

  const headers = await firestoreHeaders(undefined, true);

  const httpResponse = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  await assertFirestoreOk(httpResponse, 'addDoc');

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
  fields?: string[];
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

// Restricts the query to the named fields. Document ids always come back regardless (they are
// part of each document's resource name, not a field), so a projection never has to ask for
// __name__ to keep `snap.docs[].id` working.
export function clientSelect(...fields: string[]): QueryConstraint {
  return { type: 'select', fields };
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

// Translates one queued batch/transaction operation into the `Write` message shape the
// Firestore REST `:commit` endpoint expects.
//
// `update` and merged `set` both carry an updateMask, which is what makes them a field-level
// merge rather than a whole-document replace — identical semantics to the single-document
// PATCH calls these used to be issued as, so nothing downstream changes shape. A `set` with
// no merge option deliberately omits the mask, which is Firestore's full-replace.
function toRestWrite(op: any, db?: DatabaseHandle): any {
  const ref = op.docRef;
  const name = `${getDocumentsPath(ref?.db || db)}/${ref.collectionName}/${ref.id}`;

  if (op.type === 'delete') {
    return { delete: name };
  }

  const write: any = { update: { name, fields: toFirestoreFields(op.data) } };
  const isMerge = op.type === 'update' || !!op.options?.merge;
  if (isMerge) {
    write.updateMask = { fieldPaths: Object.keys(op.data || {}).filter((key) => op.data[key] !== undefined) };
  }
  return write;
}

// ONE HTTP round trip for up to 500 writes, applied atomically by Firestore.
//
// This is the primitive clientWriteBatch and clientRunTransaction are built on, and the
// reason both are now what their names always claimed. The previous implementation looped
// `await clientSetDoc(...)` once per document, so a "batch" of 500 attempt autosaves was 500
// serial HTTPS requests: the write queue's real drain rate was bounded by MAX_CONCURRENT_BATCHES
// (12) writes in flight — roughly 250 writes/sec, not the ~5,000/sec its own comment assumed —
// and a mid-loop failure left the first N documents committed and the rest not.
//
// Atomicity also removes a bug in the queue's sequential fallback: on a failed commit nothing
// has been written, so re-running the whole batch one write at a time can no longer re-apply
// writes that already landed.
async function commitWritesImpl(params: { db?: DatabaseHandle; writes: any[]; transaction?: string }): Promise<void> {
  const { db, writes, transaction } = params;
  if (writes.length === 0) return;

  const url = `${getBaseUrl(db)}:commit?key=${apiKeyFor(db)}`;
  const headers = await firestoreHeaders(db, true);

  const body: any = { writes };
  if (transaction) body.transaction = transaction;

  const httpResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  await assertFirestoreOk(httpResponse, 'commit');
}

// Retried and breaker-wrapped like every other entry point. Safe to retry: every write in a
// batch addresses an explicit document id (never an auto-assigned one, unlike clientAddDoc),
// so replaying a commit whose response was lost converges on the same documents rather than
// duplicating them.
export const commitWrites = createBreaker('firestore.commit', withRetry('firestore.commit', commitWritesImpl));

export function clientWriteBatch(dbInstance: any) {
  const operations: any[] = [];
  const db: DatabaseHandle | undefined = dbInstance && dbInstance.type === 'db' ? dbInstance : undefined;
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
      await commitWrites({ db, writes: operations.map((op) => toRestWrite(op, db)) });
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
    const headers = await firestoreHeaders(queryRef.db, true);

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

    await assertFirestoreOk(httpResponse, 'count');

    const payload = await httpResponse.json();
    const rows = Array.isArray(payload) ? payload : [payload];
    const raw = rows.find((row: any) => row?.result?.aggregateFields?.total)?.result?.aggregateFields?.total;
    const count = raw ? parseInt(raw.integerValue ?? raw.doubleValue ?? '0', 10) : 0;
    return { data: () => ({ count }) };
  } catch (err) {
    logger.warn('Aggregation count failed, falling back to counting by fetch', { err });
    const snap = await clientGetDocs(queryRef);
    return { data: () => ({ count: snap.docs.length }) };
  }
}

async function beginTransaction(db?: DatabaseHandle): Promise<string> {
  const url = `${getBaseUrl(db)}:beginTransaction?key=${apiKeyFor(db)}`;
  const headers = await firestoreHeaders(db, true);

  const httpResponse = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ options: { readWrite: {} } }) });
  await assertFirestoreOk(httpResponse, 'beginTransaction');
  const payload = await httpResponse.json();
  return payload.transaction as string;
}

// Best-effort: a transaction left un-rolled-back expires on its own, so a failed rollback is
// logged rather than raised — surfacing it would replace the caller's real error (the reason
// we are rolling back at all) with a less useful one.
async function rollbackTransaction(transaction: string, db?: DatabaseHandle): Promise<void> {
  try {
    const url = `${getBaseUrl(db)}:rollback?key=${apiKeyFor(db)}`;
    const headers = await firestoreHeaders(db, true);
    await fetch(url, { method: 'POST', headers, body: JSON.stringify({ transaction }) });
  } catch (err) {
    logger.warn('Transaction rollback failed (transaction will expire on its own)', { err });
  }
}

// A document read INSIDE a transaction. Passing the transaction id is what registers the read
// with Firestore, so the eventual commit fails if the document changed in between — that
// registration is the entire mechanism, and without it a "transaction" is just reads followed
// by unrelated writes.
async function getDocInTransaction(docRef: any, transaction: string) {
  const db = docRef.db;
  // `:batchGet` with the transaction id in the JSON BODY, rather than a plain document GET with
  // `?transaction=` in the query string.
  //
  // A transaction id is a bytes value. Real Firestore accepts it base64-encoded in a query
  // parameter, but the emulator's REST-to-gRPC adapter cannot map a BYTE_STRING arriving that
  // way: it throws `IllegalArgumentException: Unmapped JavaType: BYTE_STRING` and drops the
  // connection WITHOUT sending a response, so the caller hangs until it times out rather than
  // seeing an error. batchGet carries the same value in the request body, which both the real
  // service and the emulator handle, and is the documented way to read inside a transaction.
  const url = `${getBaseUrl(db)}:batchGet?key=${apiKeyFor(db)}`;
  const headers = await firestoreHeaders(db, true);
  const documentName = `${getDocumentsPath(db)}/${docRef.collectionName}/${docRef.id}`;

  const httpResponse = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ documents: [documentName], transaction })
  });
  await assertFirestoreOk(httpResponse, 'transactional get');

  // Response is one entry per requested document: `found` with the document, or `missing` with
  // just its name. A missing document is a normal outcome here, not an error — the enrollment
  // flow reads attempts and links that may not exist yet.
  const payload = await httpResponse.json();
  const entry = Array.isArray(payload) ? payload.find((row: any) => row.found || row.missing) : null;
  if (!entry || !entry.found) {
    return { id: docRef.id, exists: () => false, data: (): any => null };
  }

  const docData = fromFirestoreFields(entry.found.fields || {});
  return { id: docRef.id, exists: () => true, data: () => docData };
}

// Firestore returns ABORTED (HTTP 409) when another writer touched a document this transaction
// read. That is the expected, routine outcome under contention, not an error to surface — the
// contract is to re-run the whole callback against fresh reads.
const TRANSACTION_MAX_ATTEMPTS = 5;

function isAbortedError(err: any): boolean {
  return err instanceof FirestoreRestError && (err.status === 409 || err.status === 412);
}

/**
 * A REAL Firestore transaction: beginTransaction, transactional reads, atomic commit, rollback
 * on failure, and re-run on ABORTED.
 *
 * The previous implementation did none of that. It read with ordinary non-transactional gets,
 * buffered the writes, and then replayed them as independent single-document PATCHes after the
 * callback returned. Nothing detected a concurrent writer, so two enrollments arriving together
 * for the same student both read "no attempt exists" and both created one; and a partial
 * failure mid-replay left some writes applied and the rest not, with no rollback.
 *
 * The buffered-write shape is preserved exactly — transaction.set/update/delete still queue and
 * only take effect on a clean return, so a `throw` inside the callback still discards every
 * queued write (server/routes/gatekeeper.ts depends on both halves of that behaviour).
 */
export async function clientRunTransaction(dbInstance: any, updateFunction: (transaction: any) => Promise<any>) {
  const db: DatabaseHandle | undefined = dbInstance && dbInstance.type === 'db' ? dbInstance : undefined;
  let lastError: any;

  for (let attempt = 0; attempt < TRANSACTION_MAX_ATTEMPTS; attempt++) {
    const transaction = await beginTransaction(db);
    const operations: any[] = [];

    const transactionProxy = {
      get: async (docRef: any) => getDocInTransaction(docRef, transaction),
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

    try {
      const transactionResult = await updateFunction(transactionProxy);
      await commitWrites({ db, writes: operations.map((op) => toRestWrite(op, db)), transaction });
      return transactionResult;
    } catch (err: any) {
      await rollbackTransaction(transaction, db);
      lastError = err;

      // Only contention is retryable. A ConflictError thrown by the callback itself (e.g.
      // EXAM_ALREADY_COMPLETED) is a decision, not a collision — re-running would just reach
      // the same decision after another round of reads.
      if (!isAbortedError(err) || attempt === TRANSACTION_MAX_ATTEMPTS - 1) {
        throw err;
      }
      const delay = Math.random() * Math.min(2000, 100 * 2 ** attempt);
      logger.warn('Transaction aborted by contention, retrying', {
        attempt: attempt + 1,
        maxAttempts: TRANSACTION_MAX_ATTEMPTS,
        delayMs: Math.round(delay)
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
