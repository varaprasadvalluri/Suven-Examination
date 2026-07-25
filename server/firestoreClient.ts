import { GoogleAuth } from 'google-auth-library';
import { firebaseConfig } from './config';

// REST Client configuration
export const getBaseUrl = () => `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

// Exported for direct reuse by the GCP billing/IAM routes, which use the same ADC client
// and auto-detected project ID outside of Firestore REST calls.
export const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/cloud-platform']
});

export let detectedContainerProjectId: string | null = null;
let cachedToken: { token: string; expiry: number } | null = null;

export async function getAuthHeader(): Promise<Record<string, string>> {
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
      return { 'Authorization': `Bearer ${cachedToken.token}` };
    }
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (tokenResponse.token) {
      cachedToken = {
        token: tokenResponse.token,
        expiry: Date.now() + 3000000 // Cached for 50 minutes
      };
      return { 'Authorization': `Bearer ${tokenResponse.token}` };
    }
  } catch (err) {
    console.warn('[Firestore Auth] Failed to get Application Default Credentials token, falling back to apiKey:', err);
  }
  return {};
}

console.log(`[NODE EXPRESS SERVER] Routed safely via Firestore REST API Gateway to DB: "${firebaseConfig.firestoreDatabaseId}"`);

export const clientDb = { type: 'db' };

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
        values: val.map(v => toFirestoreValue(v))
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
  return keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
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
    case '<': return 'LESS_THAN';
    case '<=': return 'LESS_THAN_OR_EQUAL';
    case '>': return 'GREATER_THAN';
    case '>=': return 'GREATER_THAN_OR_EQUAL';
    case '==': return 'EQUAL';
    case '!=': return 'NOT_EQUAL';
    case 'array-contains': return 'ARRAY_CONTAINS';
    case 'in': return 'IN';
    case 'array-contains-any': return 'ARRAY_CONTAINS_ANY';
    case 'not-in': return 'NOT_IN';
    default: return 'EQUAL';
  }
}

// --- REST CLIENT WRAPPERS FOR COMPATIBILITY ---

export function clientCollection(parent: any, collectionName: string) {
  if (parent && parent.type === 'doc') {
    return { type: 'collection', collectionName: `${parent.collectionName}/${parent.id}/${collectionName}` };
  }
  return { type: 'collection', collectionName };
}

export function clientDoc(...args: any[]) {
  if (args.length === 3) {
    const colName = args[1];
    const id = args[2];
    return { type: 'doc', collectionName: colName, id };
  } else if (args.length === 2) {
    const parent = args[0];
    const id = args[1];
    if (parent && parent.type === 'collection') {
      return { type: 'doc', collectionName: parent.collectionName, id };
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

export async function clientGetDoc(docRef: any) {
  const url = `${getBaseUrl()}/${docRef.collectionName}/${docRef.id}?key=${firebaseConfig.apiKey}`;
  try {
    const headers: Record<string, string> = {};
    const authHeader = await getAuthHeader();
    Object.assign(headers, authHeader);

    const res = await fetch(url, { headers });
    if (res.status === 404) {
      return {
        id: docRef.id,
        exists: () => false,
        data: () => null
      };
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore REST error: ${res.status} ${errText}`);
    }
    const payload = await res.json();
    const data = fromFirestoreFields(payload.fields || {});
    return {
      id: docRef.id,
      exists: () => true,
      data: () => data
    };
  } catch (err: any) {
    console.error(`Error in clientGetDoc for ${docRef.collectionName}/${docRef.id}:`, err);
    throw err;
  }
}

export async function clientGetDocs(queryRef: any) {
  const collectionName = queryRef.collectionName;
  const constraints = queryRef.constraints || [];

  const { parentPath, collectionId } = parseCollectionPath(collectionName);
  const urlPath = parentPath ? `/${parentPath}:runQuery` : ':runQuery';
  const url = `${getBaseUrl()}${urlPath}?key=${firebaseConfig.apiKey}`;

  const structuredQuery: any = {
    from: [{ collectionId }]
  };

  const whereConstraints = constraints.filter((c: any) => c.type === 'where');
  const orderByConstraints = constraints.filter((c: any) => c.type === 'orderBy');
  const limitConstraints = constraints.filter((c: any) => c.type === 'limit');
  const startAfterConstraints = constraints.filter((c: any) => c.type === 'startAfter');

  if (whereConstraints.length > 0) {
    const filters = whereConstraints.map((c: any) => {
      return {
        fieldFilter: {
          field: { fieldPath: c.field },
          op: mapOp(c.op),
          value: toFirestoreValue(c.value)
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
    structuredQuery.orderBy = orderByConstraints.map((c: any) => ({
      field: { fieldPath: c.field },
      direction: c.direction === 'desc' ? 'DESCENDING' : 'ASCENDING'
    }));
  }

  const hasStartAfter = startAfterConstraints.length > 0;
  if (limitConstraints.length > 0 && !hasStartAfter) {
    structuredQuery.limit = limitConstraints[0].limit;
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authHeader = await getAuthHeader();
    Object.assign(headers, authHeader);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ structuredQuery })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore REST runQuery error: ${res.status} ${errText}`);
    }

    const payload = await res.json();
    let rawDocs = (payload || [])
      .filter((item: any) => item && item.document)
      .map((item: any) => {
        const doc = item.document;
        const id = doc.name.split('/').pop();
        const data = fromFirestoreFields(doc.fields || {});
        return {
          id,
          exists: () => true,
          data: () => data
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
      forEach: (cb: (doc: any) => void) => rawDocs.forEach(cb)
    };
  } catch (err: any) {
    console.error(`Error in clientGetDocs for ${collectionName}:`, err);
    throw err;
  }
}

export async function clientSetDoc(docRef: any, data: any, options?: any) {
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

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore REST setDoc error: ${res.status} ${errText}`);
  }

  return { success: true };
}

export async function clientUpdateDoc(docRef: any, data: any) {
  let url = `${getBaseUrl()}/${docRef.collectionName}/${docRef.id}?key=${firebaseConfig.apiKey}`;
  const params = buildUpdateMaskParams(data);
  if (params) {
    url += `&${params}`;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authHeader = await getAuthHeader();
  Object.assign(headers, authHeader);

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore REST updateDoc error: ${res.status} ${errText}`);
  }

  return { success: true };
}

export async function clientDeleteDoc(docRef: any) {
  const url = `${getBaseUrl()}/${docRef.collectionName}/${docRef.id}?key=${firebaseConfig.apiKey}`;

  const headers: Record<string, string> = {};
  const authHeader = await getAuthHeader();
  Object.assign(headers, authHeader);

  const res = await fetch(url, {
    method: 'DELETE',
    headers
  });

  if (!res.ok && res.status !== 404) {
    const errText = await res.text();
    throw new Error(`Firestore REST deleteDoc error: ${res.status} ${errText}`);
  }

  return { success: true };
}

export async function clientAddDoc(collectionRef: any, data: any) {
  const url = `${getBaseUrl()}/${collectionRef.collectionName}?key=${firebaseConfig.apiKey}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authHeader = await getAuthHeader();
  Object.assign(headers, authHeader);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore REST addDoc error: ${res.status} ${errText}`);
  }

  const payload = await res.json();
  const id = payload.name.split('/').pop();
  return { id };
}

export interface QueryConstraint {
  type: string;
  field?: string;
  op?: string;
  value?: any;
  direction?: 'asc' | 'desc';
  limit?: number;
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

export function clientStartAfter(docSnapshot: any): QueryConstraint {
  return { type: 'startAfter', startAfter: docSnapshot };
}

export function clientQuery(...args: any[]) {
  if (args.length === 0) return null;
  const collectionRef = args[0];
  const constraints: any[] = [];
  for (let i = 1; i < args.length; i++) {
    const c = args[i];
    if (c) constraints.push(c);
  }
  return {
    type: 'query',
    collectionName: collectionRef.collectionName,
    constraints
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

export async function clientGetCountFromServer(queryRef: any) {
  const snap = await clientGetDocs(queryRef);
  return {
    data: () => ({
      count: snap.docs.length
    })
  };
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

  const result = await updateFunction(transactionProxy);

  for (const op of operations) {
    if (op.type === 'set') {
      await clientSetDoc(op.docRef, op.data, op.options);
    } else if (op.type === 'update') {
      await clientUpdateDoc(op.docRef, op.data);
    } else if (op.type === 'delete') {
      await clientDeleteDoc(op.docRef);
    }
  }

  return result;
}
