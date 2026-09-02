// In-memory stand-in for Firestore during high-concurrency load tests, so a stress run doesn't
// burn real read/write quota on documents it invented itself. Reached from two places: the
// enroll route's load-test bypass (server/routes/gatekeeper.ts) and /api/db/write's and
// /api/db/query's load-test branches (server/routes/db.ts).
//
// BOUNDED, unlike the bare Map this replaces. A 50,000-student run writes two entries per
// simulated student — a full profile and a full attempt — and nothing ever removed them, so
// the store grew for the length of the run and stayed resident afterwards, on every worker of
// every instance the run touched. That is memory taken away from the write queue's backlog
// (server/db/writeQueue.ts) on exactly the machines under test, which makes a load test
// measure the load test rather than the app.
//
// Eviction is oldest-first: a Map iterates in insertion order, and a load test's interest is
// always in the identities it is currently driving, never the ones it finished with.
const MAX_ENTRIES = 50000;

class LoadTestStore {
  private readonly store = new Map<string, any>();

  get(key: string): any {
    return this.store.get(key);
  }

  set(key: string, value: any): void {
    // Re-inserting moves a key to the newest position, so an identity that is still being
    // driven does not age out from under an in-flight run.
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, value);
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

export const mockLoadTestStore = new LoadTestStore();
