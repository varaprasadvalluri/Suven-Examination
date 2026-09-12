import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs, clientLimit } from './firestoreClient';
import { enqueueWrite } from './writeQueue';

// Firestore caps a query page, and a cascade delete may span far more documents than that,
// so every dependent collection is drained a page at a time rather than read in one go.
export const DELETE_PAGE_SIZE = 500;

export interface CascadeDeleteResult {
  deleted: number;
  failed: number;
}

/**
 * Deletes every document in `collectionName` whose `scopeField` equals `scopeValue`, a
 * bounded page at a time.
 *
 * Existed verbatim in both SchoolController (scoped by schoolId) and StudentController
 * (scoped by studentId) — the same loop, the same page size, the same two termination
 * conditions, differing only in which field names the owner. The subtle part is the failure
 * handling, and duplicating that is how the two copies eventually stop agreeing.
 */
export async function cascadeDeleteByScope(collectionName: string, scopeField: string, scopeValue: string): Promise<CascadeDeleteResult> {
  let deleted = 0;
  let failed = 0;

  // Loop a bounded query until it comes back empty — deletions shrink the match set each
  // pass, so this never re-reads more than DELETE_PAGE_SIZE docs at a time regardless of
  // how large the school (or student history) is.
  while (true) {
    const snap = await clientGetDocs(
      clientQuery(clientCollection(clientDb, collectionName), clientWhere(scopeField, '==', scopeValue), clientLimit(DELETE_PAGE_SIZE))
    );
    if (snap.docs.length === 0) break;

    const settled = await Promise.allSettled(snap.docs.map((d: any) => enqueueWrite({ type: 'delete', collectionName, docId: d.id })));
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') deleted++;
      else failed++;
    }

    // A failed op's doc wasn't actually deleted, so it would match the same query again next
    // pass and loop forever — stop this collection's loop on any failure rather than spin;
    // the counts already collected are accurate and reported.
    if (failed > 0) break;
    if (snap.docs.length < DELETE_PAGE_SIZE) break;
  }

  return { deleted, failed };
}
