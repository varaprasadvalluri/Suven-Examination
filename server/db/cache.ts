// Query cache with TTLs to cut Firestore read costs and smooth burst QPS on hot collections
// (Blaze plan is pay-per-read, not free-tier-capped — this is about cost/latency, not a quota wall)
export const CACHE_TTLS: Record<string, number> = {
  schools: 12000, // 12s cache
  exams: 8000, // 8s cache
  syllabus: 20000, // 20s cache
  questions: 15000, // 15s cache
  login_options: 60000, // 60s cache
  invitations: 5000, // 5s cache
  subject_categories: 30000, // 30s cache — small admin-curated list, changes rarely
  academic_levels: 30000 // 30s cache — same
};

// Wraps the underlying Map so nothing outside this file can reach in and store a malformed
// entry or bypass the invalidate-by-collection logic below — callers only ever see get/set/
// invalidate, same as before this was a class, just no longer a bare Map floating at module
// scope next to unrelated exports.
class QueryCacheService {
  private readonly store = new Map<string, { timestamp: number; data: any }>();

  get(key: string) {
    return this.store.get(key);
  }

  set(key: string, value: { timestamp: number; data: any }) {
    this.store.set(key, value);
  }

  // Invalidates all cache entries for a given collection on write.
  invalidate(collectionName: string) {
    for (const key of this.store.keys()) {
      try {
        const parsed = JSON.parse(key);
        if (parsed.collectionName === collectionName) {
          this.store.delete(key);
        }
      } catch (e) {
        // Ignore parse issues
      }
    }
  }
}

export const queryCache = new QueryCacheService();

// Backward-compatible named export — every existing call site keeps working unchanged.
export const invalidateCache = queryCache.invalidate.bind(queryCache);
