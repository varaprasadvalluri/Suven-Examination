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
      } catch (_e) {
        // Ignore parse issues
      }
    }
  }
}

export const queryCache = new QueryCacheService();

// Backward-compatible named export — every existing call site keeps working unchanged.
export const invalidateCache = queryCache.invalidate.bind(queryCache);

/**
 * Read-through cache for a whole-collection list.
 *
 * The build-key / check-TTL / return-fromCache / fetch / store sequence was duplicated
 * verbatim in SchoolController, LoginOptionsController and createNamedListController —
 * ten near-identical lines each, differing only in the collection name and the DAO call.
 * Any change to caching policy (a stampede guard, key versioning, moving to Redis) had to be
 * made in three places and would eventually have been made in two.
 *
 * Deliberately NOT used by /api/db/query: that path keys on arbitrary query constraints, has
 * a separate countOnly branch, and re-sanitizes the cached payload per caller before
 * returning it. Forcing it through this signature would make both call sites worse.
 */
export async function readThrough<T>(collectionName: string, fetch: () => Promise<T>): Promise<{ data: T; fromCache: boolean }> {
  const cacheKey = JSON.stringify({ collectionName, constraints: [] });
  const ttl = CACHE_TTLS[collectionName] || 0;

  const cached = queryCache.get(cacheKey);
  if (ttl > 0 && cached && Date.now() - cached.timestamp < ttl) {
    return { data: cached.data as T, fromCache: true };
  }

  const data = await fetch();
  if (ttl > 0) {
    queryCache.set(cacheKey, { timestamp: Date.now(), data });
  }
  return { data, fromCache: false };
}
