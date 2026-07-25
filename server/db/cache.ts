// Query cache with TTLs to drastically minimize reads (staying under the 50k free limit)
export const queryCache = new Map<string, { timestamp: number; data: any }>();
export const CACHE_TTLS: Record<string, number> = {
  'schools': 12000,       // 12s cache
  'exams': 8000,          // 8s cache
  'syllabus': 20000,      // 20s cache
  'questions': 15000,     // 15s cache
  'login_options': 60000, // 60s cache
  'invitations': 5000,    // 5s cache
};

// Helper to invalidate all cache entries for a given collection on write
export function invalidateCache(collectionName: string) {
  for (const key of queryCache.keys()) {
    try {
      const parsed = JSON.parse(key);
      if (parsed.collectionName === collectionName) {
        queryCache.delete(key);
      }
    } catch (e) {
      // Ignore parse issues
    }
  }
}
