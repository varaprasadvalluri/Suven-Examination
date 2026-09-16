// Short-lived in-process cache for reads that are identical across many concurrent callers.
//
// The case this exists for is the student dashboard: what it reads per student is mostly not
// per-student at all. The school's active exam links, the school's published exam list and the
// exam documents themselves are the same bytes for every student of that school, and at cohort
// scale that is the same query answered thousands of times inside one poll interval.
//
// Two separate savings, and the second is the one that matters during a rush:
//   - a HIT inside the TTL skips the read entirely;
//   - a MISS that arrives while another caller's read is still in flight joins that read
//     instead of starting a second one (single-flight). Without this, the moment a cache entry
//     expires every in-flight request for that key misses at once and they all stampede the
//     database together — which is precisely when the system is busiest.
//
// Deliberately per-process, like the query cache in the db proxy: each instance keeps its own
// copy, so the saving scales with how many callers one instance is serving rather than needing
// any shared infrastructure. Entries are small and bounded by key count, and expire on their
// own.
//
// NOT for anything caller-specific. A key must fully determine the value for every caller that
// could hit it — cache a school's exam list, never "this student's dashboard".

interface CacheEntry<T> {
  // The in-flight or settled read. Stored as the promise rather than the value so that
  // concurrent misses can share one read.
  value: Promise<T>;
  // When this entry stops being served. Set once the read RESOLVES, not when it starts, so a
  // slow read doesn't spend most of its TTL already in flight.
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    // Injected so tests can drive expiry without sleeping or faking global time.
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Returns the cached value for `key`, the in-flight read for it, or starts one with `load`.
   *
   * A rejected read is evicted rather than cached: a transient failure must not be replayed to
   * every caller for the rest of the TTL. The next caller retries for real.
   */
  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    // An entry still loading has expiresAt 0 and is served to joiners; one that has settled is
    // served until its expiry passes.
    if (existing && (existing.expiresAt === 0 || existing.expiresAt > this.now())) {
      return existing.value;
    }

    const entry: CacheEntry<T> = { value: load(), expiresAt: 0 };
    this.entries.set(key, entry);

    try {
      const value = await entry.value;
      // Only extend the entry if it is still the current one — a clear() during the read must
      // not be undone by the read that was in flight when it happened.
      if (this.entries.get(key) === entry) entry.expiresAt = this.now() + this.ttlMs;
      return value;
    } catch (err) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw err;
    }
  }

  // Drops everything. For tests, and for a caller that knows it has just invalidated the
  // underlying data.
  clear(): void {
    this.entries.clear();
  }
}
