/**
 * Edu ID Generator
 *
 * Generates prefixed, shard-friendly document IDs for Firestore collections.
 *
 * This was previously a Singleton factory holding a swappable Strategy behind an interface.
 * That structure was removed rather than extended: there was only ever one strategy, and the
 * `setStrategy()` setter was never called from anywhere in the codebase — so the interface,
 * the setter and the private constructor bought no flexibility while adding indirection and a
 * live footgun (any module could have silently repointed ID generation for the whole process).
 * The pattern is worth reintroducing on the day a second generation algorithm actually exists.
 *
 * The generated ID FORMAT is unchanged — `edu-{prefix}-{12 hex}-{base36 timestamp}` — because
 * IDs already written to Firestore have to keep parsing and sorting the same way.
 */

import crypto from 'crypto';

// A lookup rather than a switch: adding a collection is adding a key, not editing a function.
// The previous 12-case switch meant every new collection required modifying the generator
// itself, which is precisely the closed-to-extension shape the old "Strategy" was supposed to
// prevent.
const COLLECTION_PREFIXES: Record<string, string> = {
  schools: 'sch',
  login_options: 'opt',
  users: 'usr',
  invitations: 'inv',
  secure_exam_links: 'lnk',
  exams: 'exm',
  questions: 'qst',
  attempts: 'att',
  microschedules: 'schd',
  error_books: 'err',
  proctoring_logs: 'prc',
  syllabus: 'syl',
  subject_categories: 'sbc',
  academic_levels: 'acl'
};

const FALLBACK_PREFIX = 'gen';

export function getCollectionPrefix(collectionName: string): string {
  return COLLECTION_PREFIXES[collectionName] ?? FALLBACK_PREFIX;
}

// Runs on both sides of the wire, so it has to work under Node and in the browser.
function randomHex16(): string {
  if (typeof window === 'undefined' && crypto?.randomBytes) {
    return crypto.randomBytes(8).toString('hex');
  }

  const array = new Uint32Array(2);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(array);
    return Array.from(array)
      .map((randomUint32) => randomUint32.toString(16).padStart(8, '0'))
      .join('');
  }

  return Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 10);
}

/**
 * Builds a document ID for `collectionName`.
 *
 * Random component leads (right after the fixed collection prefix), timestamp trails —
 * Firestore range-shards writes by the lexicographic doc ID, so a burst of near-simultaneous
 * writes (e.g. thousands of students triggering a proctoring event in the same second) sharing
 * an identical "edu-{prefix}-{timestamp}-" lead would concentrate on one shard. Leading with 12
 * random hex chars spreads that same burst across the keyspace; the timestamp trails for
 * human-readable chronological debugging only, not sharding.
 */
export function generateEduKey(collectionName: string): string {
  const prefix = getCollectionPrefix(collectionName);
  const timestamp = Date.now().toString(36);
  return `edu-${prefix}-${randomHex16().substring(0, 12)}-${timestamp}`;
}
