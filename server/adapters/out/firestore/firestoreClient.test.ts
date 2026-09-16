import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// These cover the two primitives that used to be misnamed: clientWriteBatch, which looped one
// HTTP PATCH per document and called it a batch, and clientRunTransaction, which read
// non-transactionally and replayed its writes afterwards. Both are asserted at the HTTP layer,
// because "did it actually issue one atomic commit" is the whole property under test and it is
// invisible from the return value.

vi.mock('../../../config', () => ({
  firebaseConfig: {
    projectId: 'test-project',
    firestoreDatabaseId: 'test-db',
    apiKey: 'test-key',
    storageBucket: ''
  },
  // Not emulated: these tests assert the real-service URLs and the ADC path.
  firestoreEmulatorHost: '',
  isFirestoreEmulated: false
}));

// GoogleAuth would otherwise reach for the GCE metadata server during getAuthHeader.
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    async getProjectId() {
      return 'test-project';
    }
    async getClient() {
      // A real token, so the ADC path is actually exercised rather than silently falling
      // through to the API-key-only branch on every call.
      return { getAccessToken: async (): Promise<{ token: string | null }> => ({ token: 'adc-token' }) };
    }
  }
}));

import {
  clientDb,
  clientDoc,
  clientWriteBatch,
  clientRunTransaction,
  clientCollection,
  clientQuery,
  clientOrderBy,
  clientLimit,
  clientStartAfter,
  clientGetDocs,
  clientSelect,
  clientWhere
} from './firestoreClient';

const fetchMock = vi.fn();

function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function callsTo(fragment: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment));
}

function bodyOf(call: any[]) {
  return JSON.parse(call[1].body);
}

describe('clientWriteBatch', () => {
  it('commits every operation in ONE request instead of one request per document', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    const batch = clientWriteBatch(clientDb);
    for (let i = 0; i < 25; i++) {
      batch.update(clientDoc(clientDb, 'attempts', `att_${i}`), { status: 'submitted' });
    }
    await batch.commit();

    // The regression this guards: 25 documents used to mean 25 serial round trips, which is
    // what held the write queue's real drain rate to a fraction of its assumed throughput.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const commitCalls = callsTo(':commit');
    expect(commitCalls).toHaveLength(1);
    expect(bodyOf(commitCalls[0]).writes).toHaveLength(25);
  });

  it('sends an updateMask for merges so a partial write stays a merge, not a replace', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    const batch = clientWriteBatch(clientDb);
    batch.update(clientDoc(clientDb, 'attempts', 'att_1'), { status: 'submitted', score: 12 });
    batch.set(clientDoc(clientDb, 'attempts', 'att_2'), { status: 'started' }, { merge: true });
    batch.set(clientDoc(clientDb, 'users', 'u_1'), { name: 'Full Replace' });
    batch.delete(clientDoc(clientDb, 'attempts', 'att_3'));
    await batch.commit();

    const writes = bodyOf(callsTo(':commit')[0]).writes;
    expect(writes[0].updateMask.fieldPaths).toEqual(['status', 'score']);
    expect(writes[1].updateMask.fieldPaths).toEqual(['status']);
    // A set with no merge option is a full-document replace, which is exactly no mask.
    expect(writes[2].updateMask).toBeUndefined();
    expect(writes[3].delete).toContain('attempts/att_3');
  });

  it('addresses documents by resource name under the configured project and database', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    const batch = clientWriteBatch(clientDb);
    batch.update(clientDoc(clientDb, 'attempts', 'att_1'), { status: 'submitted' });
    await batch.commit();

    const writes = bodyOf(callsTo(':commit')[0]).writes;
    expect(writes[0].update.name).toBe('projects/test-project/databases/test-db/documents/attempts/att_1');
  });

  it('commits nothing at all when no operations were queued', async () => {
    const batch = clientWriteBatch(clientDb);
    await batch.commit();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('clientRunTransaction', () => {
  it('begins a transaction, reads inside it, and commits the queued writes against it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes(':beginTransaction')) return jsonResponse({ transaction: 'txn-1' });
      if (String(url).includes(':commit')) return jsonResponse({});
      // batchGet answers with one entry per requested document.
      return jsonResponse([{ found: { name: 'attempts/att_1', fields: { status: { stringValue: 'started' } } } }]);
    });

    const result = await clientRunTransaction(clientDb, async (transaction: any) => {
      const snap = await transaction.get(clientDoc(clientDb, 'attempts', 'att_1'));
      expect(snap.exists()).toBe(true);
      expect(snap.data()).toEqual({ status: 'started' });
      transaction.update(clientDoc(clientDb, 'attempts', 'att_1'), { status: 'submitted' });
      return 'callback-return-value';
    });

    expect(result).toBe('callback-return-value');
    expect(callsTo(':beginTransaction')).toHaveLength(1);

    // The read carries the transaction id — that registration is what makes the commit fail if
    // another writer touched the document, and is the entire difference from a plain get. It
    // rides in the batchGet BODY rather than a query parameter: a transaction id is a bytes
    // value, and the Firestore emulator cannot map one arriving as a query parameter (it drops
    // the connection without responding, so the caller hangs rather than failing).
    const readCall = callsTo(':batchGet')[0];
    const readBody = bodyOf(readCall);
    expect(readBody.transaction).toBe('txn-1');
    expect(readBody.documents).toEqual(['projects/test-project/databases/test-db/documents/attempts/att_1']);

    const commitBody = bodyOf(callsTo(':commit')[0]);
    expect(commitBody.transaction).toBe('txn-1');
    expect(commitBody.writes).toHaveLength(1);
  });

  it('reports a missing document as not-existing rather than throwing', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes(':beginTransaction')) return jsonResponse({ transaction: 'txn-1' });
      if (String(url).includes(':commit')) return jsonResponse({});
      // batchGet reports an absent document as `missing`, not as an HTTP 404.
      return jsonResponse([{ missing: 'projects/test-project/databases/test-db/documents/attempts/missing' }]);
    });

    await clientRunTransaction(clientDb, async (transaction: any) => {
      const snap = await transaction.get(clientDoc(clientDb, 'attempts', 'missing'));
      expect(snap.exists()).toBe(false);
      expect(snap.data()).toBeNull();
    });
  });

  it('rolls back and queues no writes when the callback throws', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes(':beginTransaction')) return jsonResponse({ transaction: 'txn-1' });
      return jsonResponse([{ found: { name: 'attempts/att_1', fields: {} } }]);
    });

    await expect(
      clientRunTransaction(clientDb, async (transaction: any) => {
        transaction.update(clientDoc(clientDb, 'attempts', 'att_1'), { status: 'expired' });
        throw new Error('EXAM_ALREADY_COMPLETED');
      })
    ).rejects.toThrow('EXAM_ALREADY_COMPLETED');

    // gatekeeper.ts's enroll flow depends on both halves of this: nothing is written, and the
    // caller's own error is what surfaces.
    expect(callsTo(':commit')).toHaveLength(0);
    expect(callsTo(':rollback')).toHaveLength(1);
  });

  it('re-runs the callback against fresh reads when the commit is ABORTED by contention', async () => {
    let commitAttempts = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes(':beginTransaction')) return jsonResponse({ transaction: `txn-${commitAttempts}` });
      if (String(url).includes(':commit')) {
        commitAttempts++;
        // First commit loses the race; the retry wins it.
        return commitAttempts === 1 ? jsonResponse({ error: 'ABORTED' }, 409) : jsonResponse({});
      }
      return jsonResponse({ fields: {} });
    });

    let callbackRuns = 0;
    await clientRunTransaction(clientDb, async (transaction: any) => {
      callbackRuns++;
      await transaction.get(clientDoc(clientDb, 'attempts', 'att_1'));
      transaction.update(clientDoc(clientDb, 'attempts', 'att_1'), { status: 'started' });
    });

    // Re-running is the contract — the callback has to see the winner's write, not its own
    // stale read. Two enrollments arriving together for the same attempt is the real case.
    expect(callbackRuns).toBe(2);
    expect(callsTo(':beginTransaction')).toHaveLength(2);
    expect(commitAttempts).toBe(2);
  });

  it('does not retry an error the callback itself raised', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes(':beginTransaction')) return jsonResponse({ transaction: 'txn-1' });
      return jsonResponse([{ found: { name: 'attempts/att_1', fields: {} } }]);
    });

    let callbackRuns = 0;
    await expect(
      clientRunTransaction(clientDb, async () => {
        callbackRuns++;
        throw new Error('This assessment attempt has already been submitted');
      })
    ).rejects.toThrow('already been submitted');

    // A product decision is not a collision: re-reading would reach the same decision again.
    expect(callbackRuns).toBe(1);
  });
});

describe('cursor pagination', () => {
  function cursorSnapshot(id: string, data: any) {
    return { id, exists: () => true, data: () => data };
  }

  function runQueryResponse(ids: string[]) {
    return ids.map((id) => ({
      document: { name: `projects/test-project/databases/test-db/documents/users/${id}`, fields: { name: { stringValue: id } } }
    }));
  }

  it('pushes the cursor into the query instead of scanning for it in the response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(runQueryResponse(['u_11', 'u_12'])));

    await clientGetDocs(
      clientQuery(
        clientCollection(clientDb, 'users'),
        clientOrderBy('name'),
        clientLimit(10),
        clientStartAfter(cursorSnapshot('u_10', { name: 'Jordan' }))
      )
    );

    const sent = bodyOf(callsTo(':runQuery')[0]).structuredQuery;

    // The regression: a startAfter used to suppress the limit and read the WHOLE collection so
    // the cursor could be located in the parsed response. Page 2 of a 100k-row list cost
    // 100,000 reads to show ten rows.
    expect(sent.limit).toBe(10);
    expect(sent.startAt.before).toBe(false);
    expect(sent.startAt.values[0]).toEqual({ stringValue: 'Jordan' });
  });

  it('appends __name__ so documents sharing a sort value page deterministically', async () => {
    fetchMock.mockResolvedValue(jsonResponse(runQueryResponse([])));

    await clientGetDocs(
      clientQuery(
        clientCollection(clientDb, 'users'),
        clientOrderBy('name', 'desc'),
        clientLimit(10),
        clientStartAfter(cursorSnapshot('u_10', { name: 'Jordan' }))
      )
    );

    const sent = bodyOf(callsTo(':runQuery')[0]).structuredQuery;
    const lastOrderBy = sent.orderBy[sent.orderBy.length - 1];

    // Firestore orders by __name__ last regardless; stating it is what lets the cursor name a
    // single document rather than a whole run of same-named ones. Its direction must follow
    // the last real orderBy or Firestore rejects the query.
    expect(lastOrderBy).toEqual({ field: { fieldPath: '__name__' }, direction: 'DESCENDING' });
    expect(sent.startAt.values[1]).toEqual({
      referenceValue: 'projects/test-project/databases/test-db/documents/users/u_10'
    });
  });

  it('falls back to the in-memory slice when the cursor is a bare id with no document data', async () => {
    fetchMock.mockResolvedValue(jsonResponse(runQueryResponse(['u_1', 'u_2', 'u_3', 'u_4'])));

    const snap = await clientGetDocs(
      clientQuery(clientCollection(clientDb, 'users'), clientOrderBy('name'), clientLimit(2), clientStartAfter('u_2'))
    );

    const sent = bodyOf(callsTo(':runQuery')[0]).structuredQuery;
    // No field values to build a cursor from, so the surrounding documents are still needed to
    // locate it — the limit stays off and the slice happens here, exactly as it always did.
    expect(sent.limit).toBeUndefined();
    expect(sent.startAt).toBeUndefined();
    expect(snap.docs.map((d: any) => d.id)).toEqual(['u_3', 'u_4']);
  });

  it('leaves a query without a cursor completely unchanged', async () => {
    fetchMock.mockResolvedValue(jsonResponse(runQueryResponse(['u_1'])));

    await clientGetDocs(clientQuery(clientCollection(clientDb, 'users'), clientOrderBy('name'), clientLimit(10)));

    const sent = bodyOf(callsTo(':runQuery')[0]).structuredQuery;
    expect(sent.limit).toBe(10);
    expect(sent.startAt).toBeUndefined();
    expect(sent.orderBy).toEqual([{ field: { fieldPath: 'name' }, direction: 'ASCENDING' }]);
  });
});

describe('clientSelect (projection)', () => {
  it('sends a field mask so big documents are not transferred whole', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await clientGetDocs(
      clientQuery(
        clientCollection(clientDb, 'attempts'),
        clientWhere('status', '==', 'completed'),
        clientSelect('studentId', 'examId', 'score')
      )
    );

    const sent = bodyOf(callsTo(':runQuery')[0]).structuredQuery;

    // The merit-list export reads hundreds of thousands of attempts to average a score. Without
    // this mask each row also carried the student's entire answers[], which is the difference
    // between a bounded response and one that exhausts the container.
    expect(sent.select).toEqual({
      fields: [{ fieldPath: 'studentId' }, { fieldPath: 'examId' }, { fieldPath: 'score' }]
    });
    expect(sent.where).toBeDefined();
  });

  it('omits the mask entirely when no projection was asked for', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await clientGetDocs(clientQuery(clientCollection(clientDb, 'attempts')));

    expect(bodyOf(callsTo(':runQuery')[0]).structuredQuery.select).toBeUndefined();
  });

  it('still returns document ids, which are not a field and so survive any projection', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          document: {
            name: 'projects/test-project/databases/test-db/documents/attempts/att_1',
            fields: { score: { integerValue: '7' } }
          }
        }
      ])
    );

    const snap = await clientGetDocs(clientQuery(clientCollection(clientDb, 'attempts'), clientSelect('score')));

    expect(snap.docs[0].id).toBe('att_1');
    expect(snap.docs[0].data()).toEqual({ score: 7 });
  });
});

// ============================================================================
// ADC IS ATTACHED FOR A NAMED DATABASE
// ============================================================================
// The regression this guards: the ADC gate used to also require the DEFAULT database, so an
// app configured with a named Firestore database (this one uses `suven-edu`) never sent an
// Authorization header at all and fell back to Firebase-API-key-only access. Ordinary document
// reads and writes survive that; `:beginTransaction` does not, and returns 403
// PERMISSION_DENIED — which broke exam-entry enrollment, the one path built on a real
// transaction, while leaving the rest of the app looking healthy.
describe('getAuthHeader', () => {
  it('sends an ADC bearer token even though the database is a named one, not (default)', async () => {
    // The mocked config at the top of this file is exactly that shape: project 'test-project',
    // database 'test-db'. Under the old gate this returned {}.
    const { getAuthHeader } = await import('./firestoreClient');
    const headers = await getAuthHeader();

    expect(headers.Authorization).toBe('Bearer adc-token');
  });

  it('never sends this app’s token to a different project', async () => {
    // A cross-project handle (the admin migration route's source database) authenticates with
    // its own apiKey — this app's credential is not valid there, and attaching it would mask
    // the real 403 with a confusing auth error.
    const { getAuthHeader, createDatabaseHandle } = await import('./firestoreClient');
    const otherProject = createDatabaseHandle({ projectId: 'someone-elses-project', apiKey: 'their-key' });

    expect(await getAuthHeader(otherProject)).toEqual({});
  });
});

// ============================================================================
// CREDENTIAL PROBES ARE NOT REPEATED PER CALL
// ============================================================================
// getAuthHeader runs in front of EVERY Firestore call. On a machine with no Application
// Default Credentials, resolving them ends in a GCE metadata-server lookup that simply times
// out, so without a memo of that failure every read pays the timeout, retry wraps it, and the
// circuit breaker in front eventually opens — the app stops showing data at all, for want of a
// credential it was only ever going to fall back from.
describe('getAuthHeader when no credentials are available', () => {
  it('probes once and then falls back to the API key without asking again', async () => {
    const { getAuthHeader, __resetCredentialProbeState } = await import('./firestoreClient');
    const { GoogleAuth } = (await import('google-auth-library')) as any;

    __resetCredentialProbeState();
    const getClient = vi.spyOn(GoogleAuth.prototype, 'getClient').mockRejectedValue(new Error('Could not load the default credentials'));

    expect(await getAuthHeader()).toEqual({});
    expect(await getAuthHeader()).toEqual({});
    expect(await getAuthHeader()).toEqual({});

    expect(getClient).toHaveBeenCalledTimes(1);
    getClient.mockRestore();
    __resetCredentialProbeState();
  });

  it('treats a lookup that returns no token the same as one that throws', async () => {
    const { getAuthHeader, __resetCredentialProbeState } = await import('./firestoreClient');
    const { GoogleAuth } = (await import('google-auth-library')) as any;

    __resetCredentialProbeState();
    const getClient = vi
      .spyOn(GoogleAuth.prototype, 'getClient')
      .mockResolvedValue({ getAccessToken: async (): Promise<{ token: string | null }> => ({ token: null }) } as any);

    expect(await getAuthHeader()).toEqual({});
    expect(await getAuthHeader()).toEqual({});

    expect(getClient).toHaveBeenCalledTimes(1);
    getClient.mockRestore();
    __resetCredentialProbeState();
  });

  it('caches a successful token instead of re-minting it per call', async () => {
    const { getAuthHeader, __resetCredentialProbeState } = await import('./firestoreClient');
    const { GoogleAuth } = (await import('google-auth-library')) as any;

    __resetCredentialProbeState();
    const getClient = vi.spyOn(GoogleAuth.prototype, 'getClient');

    expect(await getAuthHeader()).toEqual({ Authorization: 'Bearer adc-token' });
    expect(await getAuthHeader()).toEqual({ Authorization: 'Bearer adc-token' });

    expect(getClient).toHaveBeenCalledTimes(1);
    getClient.mockRestore();
    __resetCredentialProbeState();
  });
});
