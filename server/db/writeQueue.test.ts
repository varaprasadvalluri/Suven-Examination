import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The write queue is the module that decides whether 50,000 exam submissions actually land.
// Everything below is about its behaviour under load and under failure, because that is when
// it matters and that is when nobody can debug it interactively.

const { commitMock, batchOps, setDocMock, updateDocMock, deleteDocMock, invalidateMock } = vi.hoisted(() => ({
  commitMock: vi.fn(),
  batchOps: { set: vi.fn(), update: vi.fn(), delete: vi.fn() },
  setDocMock: vi.fn(),
  updateDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
  invalidateMock: vi.fn()
}));

vi.mock('../firestoreClient', () => ({
  clientDb: { type: 'db' },
  clientDoc: vi.fn((_db: any, collectionName: string, id: string) => ({ collectionName, id })),
  clientWriteBatch: vi.fn(() => ({
    set: batchOps.set,
    update: batchOps.update,
    delete: batchOps.delete,
    commit: commitMock
  })),
  clientSetDoc: setDocMock,
  clientUpdateDoc: updateDocMock,
  clientDeleteDoc: deleteDocMock
}));

vi.mock('./cache', () => ({ invalidateCache: invalidateMock }));

async function freshQueue() {
  vi.resetModules();
  return await import('./writeQueue');
}

beforeEach(() => {
  vi.clearAllMocks();
  commitMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('enqueueWrite — the happy path', () => {
  it('resolves only after the batch has actually committed', async () => {
    const { enqueueWrite } = await freshQueue();
    let committed = false;
    commitMock.mockImplementation(async () => {
      committed = true;
    });

    const result = await enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'att_1', data: { status: 'submitted' } });

    // The promise must not settle before the write is durable — the submission path depends on
    // this to know whether it can tell the student their exam was saved.
    expect(committed).toBe(true);
    expect(result).toEqual({ success: true, id: 'att_1' });
  });

  it('generates a prefixed id for an add with no docId', async () => {
    const { enqueueWrite } = await freshQueue();

    const result = await enqueueWrite({ type: 'add', collectionName: 'attempts', data: { examId: 'e1' } });

    expect(result.id).toMatch(/^edu-att-[0-9a-f]{12}-/);
  });

  it('invalidates the cache for every collection it touched', async () => {
    const { enqueueWrite } = await freshQueue();

    await Promise.all([
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'a', data: {} }),
      enqueueWrite({ type: 'update', collectionName: 'exams', docId: 'e', data: {} })
    ]);

    const invalidated = invalidateMock.mock.calls.map((c) => c[0]);
    expect(invalidated).toContain('attempts');
    expect(invalidated).toContain('exams');
  });
});

describe('batching under exam-end load', () => {
  it('coalesces many concurrent writes into far fewer batch commits', async () => {
    const { enqueueWrite } = await freshQueue();

    // 600 students submitting in the same tick. The property that matters is that this costs
    // a handful of batch commits rather than 600 round trips — the exact count depends on how
    // the eager flush-on-enqueue interleaves with the event loop, so assert the order of
    // magnitude, not a fixed number.
    await Promise.all(
      Array.from({ length: 600 }, (_, i) =>
        enqueueWrite({ type: 'update', collectionName: 'attempts', docId: `att_${i}`, data: { status: 'submitted' } })
      )
    );

    expect(commitMock.mock.calls.length).toBeLessThan(10);
    expect(batchOps.update).toHaveBeenCalledTimes(600);
  });

  it("never puts more than Firestore's 500-operation limit in a single batch", async () => {
    const { enqueueWrite, processWriteBatch } = await freshQueue();
    const sizes: number[] = [];
    commitMock.mockImplementation(async () => {
      sizes.push(batchOps.update.mock.calls.length - sizes.reduce((a, b) => a + b, 0));
    });

    await Promise.all(
      Array.from({ length: 1400 }, (_, i) => enqueueWrite({ type: 'update', collectionName: 'attempts', docId: `att_${i}`, data: {} }))
    );

    expect(typeof processWriteBatch).toBe('function');
    for (const size of sizes) {
      expect(size).toBeLessThanOrEqual(500);
    }
  });

  it('reports a real backlog through getQueueDepth, then returns to zero', async () => {
    const { enqueueWrite, getQueueDepth } = await freshQueue();
    expect(getQueueDepth()).toBe(0);

    // Hold every commit open so the queue visibly accumulates.
    const releases: Array<() => void> = [];
    commitMock.mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));

    const writes = Array.from({ length: 8000 }, (_, i) =>
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: `att_${i}`, data: {} })
    );

    // 12 concurrent batches x 500 = 6000 taken in-flight; the rest is visible backlog. This is
    // the number the readiness probe exposes and the one to alert on during an exam window.
    expect(getQueueDepth()).toBeGreaterThan(0);

    commitMock.mockResolvedValue(undefined);
    releases.forEach((release) => release());
    await Promise.all(writes);
    expect(getQueueDepth()).toBe(0);
  });
});

describe('ordering — two writes to the same document', () => {
  it('never places them in the same parallel wave, and commits them in enqueue order', async () => {
    const { enqueueWrite } = await freshQueue();

    // The exact scenario this protects: a student's submission, then the autosave tick that
    // was already in flight behind it. Committed out of order the autosave wins, the grading
    // worker sees a status it refuses to grade, and the attempt is left silently unscored.
    await Promise.all([
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'att_1', data: { status: 'submitted' } }),
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'att_1', data: { status: 'in-progress' } })
    ]);

    const statusesInCommitOrder = batchOps.update.mock.calls
      .filter(([ref]: any[]) => ref.id === 'att_1')
      .map(([, data]: any[]) => data.status);

    expect(statusesInCommitOrder).toEqual(['submitted', 'in-progress']);
    // Two rounds means two separate commits — the second write cannot have raced the first.
    expect(commitMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a long run of writes to one document in order', async () => {
    const { enqueueWrite, flushQueue } = await freshQueue();

    const writes = Array.from({ length: 6 }, (_, i) =>
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'att_hot', data: { tick: i } })
    );
    await flushQueue();
    await Promise.all(writes);

    const ticks = batchOps.update.mock.calls.map(([, data]: any[]) => data.tick);
    expect(ticks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('still batches writes to DIFFERENT documents together, so ordering costs no throughput', async () => {
    const { enqueueWrite, flushQueue } = await freshQueue();

    const writes = Array.from({ length: 300 }, (_, i) =>
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: `att_${i}`, data: {} })
    );
    await flushQueue();
    await Promise.all(writes);

    // 300 distinct documents are all first writes, so they share a single round.
    expect(commitMock.mock.calls.length).toBeLessThan(5);
  });
});

describe('saturation — the backpressure that protects the instance', () => {
  it('rejects new writes once the queue is full instead of growing until OOM', async () => {
    const { enqueueWrite } = await freshQueue();
    // Hold the commit open so the queue cannot drain while we fill it.
    let release: () => void = () => {};
    commitMock.mockImplementation(() => new Promise<void>((resolve) => (release = () => resolve())));

    const pending: Promise<any>[] = [];
    let rejection: Error | null = null;
    // MAX_QUEUE_SIZE is 20,000, and the first eager flush takes up to 12 x 500 = 6,000
    // in-flight before blocking on the held commit — so go comfortably past both.
    for (let i = 0; i < 27000; i++) {
      const p = enqueueWrite({ type: 'update', collectionName: 'attempts', docId: `att_${i}`, data: {} }).catch((err: Error) => {
        rejection = rejection || err;
      });
      pending.push(p);
    }

    // The .catch() handlers land in microtasks, so let them run before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    expect(rejection).not.toBeNull();
    // A controlled 503 for the newest requests, not a dead container taking every in-flight
    // write for every student on the instance down with it.
    expect(String(rejection)).toMatch(/saturated/i);

    commitMock.mockResolvedValue(undefined);
    release();
    await Promise.allSettled(pending);
  });
});

describe('failure handling', () => {
  it('falls back to sequential writes when the batch commit fails, so good writes still land', async () => {
    const { enqueueWrite } = await freshQueue();
    commitMock.mockRejectedValue(new Error('batch commit failed'));
    updateDocMock.mockResolvedValue(undefined);

    const results = await Promise.all([
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'a', data: {} }),
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'b', data: {} })
    ]);

    expect(results.every((r) => r.success)).toBe(true);
    expect(updateDocMock).toHaveBeenCalledTimes(2);
  });

  it('rejects only the individual write that fails, not its batch-mates', async () => {
    const { enqueueWrite } = await freshQueue();
    commitMock.mockRejectedValue(new Error('batch commit failed'));
    updateDocMock.mockImplementation(async (ref: any) => {
      if (ref.id === 'poison') throw new Error('document is invalid');
    });

    const settled = await Promise.allSettled([
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'good', data: {} }),
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'poison', data: {} })
    ]);

    // One bad document must not fail the other students sharing its batch.
    expect(settled[0].status).toBe('fulfilled');
    expect(settled[1].status).toBe('rejected');
  });

  it('routes each task type to the right sequential fallback call', async () => {
    const { enqueueWrite } = await freshQueue();
    commitMock.mockRejectedValue(new Error('batch commit failed'));
    setDocMock.mockResolvedValue(undefined);
    updateDocMock.mockResolvedValue(undefined);
    deleteDocMock.mockResolvedValue(undefined);

    await Promise.all([
      enqueueWrite({ type: 'set', collectionName: 'attempts', docId: 's', data: {} }),
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: 'u', data: {} }),
      enqueueWrite({ type: 'delete', collectionName: 'attempts', docId: 'd' })
    ]);

    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(deleteDocMock).toHaveBeenCalledTimes(1);
  });
});

describe('flushQueue — the shutdown drain', () => {
  it('is safe to call on an empty queue', async () => {
    const { flushQueue } = await freshQueue();
    await expect(flushQueue()).resolves.toBeUndefined();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('drains everything pending, which is what SIGTERM depends on', async () => {
    const { enqueueWrite, flushQueue, getQueueDepth } = await freshQueue();

    const writes = Array.from({ length: 120 }, (_, i) =>
      enqueueWrite({ type: 'update', collectionName: 'attempts', docId: `att_${i}`, data: {} })
    );
    await flushQueue();
    await Promise.all(writes);

    expect(getQueueDepth()).toBe(0);
  });
});
