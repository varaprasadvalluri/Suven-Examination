import express from 'express';
import { schoolDao } from '../../dao';
import { queryCache, CACHE_TTLS } from '../../db/cache';
import { asyncHandler } from '../../middleware/errorHandler';
import { requireSession, requireRole } from '../../auth/middleware';
import {
  clientDb,
  clientCollection,
  clientDoc,
  clientQuery,
  clientWhere,
  clientLimit,
  clientGetDoc,
  clientGetDocs
} from '../../firestoreClient';
import { enqueueWrite } from '../../db/writeQueue';
import { logger } from '../../lib/logger';
import { NotFoundError } from '../../lib/errors';

const router = express.Router();

// v1 counterpart of server/routes/schools.ts, calling SchoolDao instead of firestoreClient
// directly. Same behavior (public read, same cache TTL), additive only — the unversioned
// /api/schools route is untouched and is what the frontend currently calls.
/**
 * @openapi
 * /api/v1/schools:
 *   get:
 *     summary: List all schools
 *     description: Public read, cached. No authentication required.
 *     tags: [Schools]
 *     security: []
 *     responses:
 *       200:
 *         description: List of schools
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 *                 fromCache: { type: boolean }
 */
router.get(
  '/api/v1/schools',
  asyncHandler(async (_req, res) => {
    const cacheKey = JSON.stringify({ collectionName: 'schools', constraints: [] });
    const ttl = CACHE_TTLS['schools'] || 0;
    const cached = queryCache.get(cacheKey);
    if (ttl > 0 && cached && Date.now() - cached.timestamp < ttl) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const docList = await schoolDao.findAll();

    if (ttl > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
    }
    return res.status(200).json({ success: true, data: docList });
  })
);

/**
 * @openapi
 * /api/v1/schools/{schoolId}:
 *   get:
 *     summary: Get a single school by ID
 *     description: Public read. No authentication required.
 *     tags: [Schools]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: School document (or a not-found result shape from the DAO)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.get(
  '/api/v1/schools/:schoolId',
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;
    const schoolResult = await schoolDao.findById(schoolId);
    return res.status(200).json({ success: true, data: schoolResult });
  })
);

// Cascade-deletes a school and everything under it. Replaces the previous client-side
// implementation (AdminSchoolManagement.tsx used Firestore's `writeBatch` API, but this
// app's writeBatch (src/lib/apiService.ts) is a client-side mock — commit() just awaits
// one /api/db/write HTTP call per queued op in a sequential loop, no real atomicity. A
// failure partway through left the school half-deleted with no rollback and no way to tell
// what survived. This route uses the real write-cushion (server/db/writeQueue.ts,
// enqueueWrite) — the same batching infra the exam-day write path runs on — and reports
// exactly what succeeded/failed per collection instead of one blanket toast.
//
// Reads are bounded per iteration via `limit` with no `startAfter` cursor — deliberately
// NOT using clientStartAfter-based pagination: that helper (firestoreClient.ts) only
// applies `limit` server-side when no startAfter is given; the moment startAfter is
// present it fetches the ENTIRE unbounded result set from Firestore and slices in memory,
// which would defeat the point of bounding this exact loop. Looping a plain bounded query
// while deleting is naturally correct here instead: each pass's matches shrink as prior
// matches get deleted, so the next bounded fetch advances on its own.
const SCHOOL_DEPENDENT_COLLECTIONS = ['users', 'invitations', 'attempts', 'error_books', 'secure_exam_links'] as const;
const DELETE_PAGE_SIZE = 500;

/**
 * @openapi
 * /api/v1/schools/{schoolId}/hard-delete:
 *   delete:
 *     summary: Permanently cascade-delete a school and all its users/invitations/attempts/error_books/secure_exam_links
 *     description: >
 *       Admin only, irreversible. Real Firestore batched deletes via the write-cushion
 *       (server/db/writeQueue.ts), not a client-side mock — reports exact per-collection
 *       success/failure. The school document itself is only deleted once every dependent
 *       collection is fully cleared; a partial failure leaves the school doc in place
 *       (still visible/re-triggerable) instead of orphaning leftover data with no parent.
 *     tags: [Schools]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Per-collection deletion counts, whether the school doc itself was removed
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: School not found
 */
router.delete(
  '/api/v1/schools/:schoolId/hard-delete',
  requireSession,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;

    const schoolSnap = await clientGetDoc(clientDoc(clientDb, 'schools', schoolId));
    if (!schoolSnap.exists()) {
      throw new NotFoundError('School not found.');
    }

    const results: Record<string, { deleted: number; failed: number }> = {};

    for (const collectionName of SCHOOL_DEPENDENT_COLLECTIONS) {
      let deleted = 0;
      let failed = 0;

      // Loop a bounded query until it comes back empty — deletions shrink the match set
      // each pass, so this never re-reads more than DELETE_PAGE_SIZE docs at a time
      // regardless of how large the school is.
      while (true) {
        const snap = await clientGetDocs(
          clientQuery(clientCollection(clientDb, collectionName), clientWhere('schoolId', '==', schoolId), clientLimit(DELETE_PAGE_SIZE))
        );
        if (snap.docs.length === 0) break;

        const settled = await Promise.allSettled(snap.docs.map((d: any) => enqueueWrite({ type: 'delete', collectionName, docId: d.id })));
        for (const outcome of settled) {
          if (outcome.status === 'fulfilled') deleted++;
          else failed++;
        }

        // A failed op's doc wasn't actually deleted, so it would match the same query
        // again next pass and loop forever — stop this collection's loop on any failure
        // rather than spin; the counts already collected are accurate and reported.
        if (failed > 0) break;
        if (snap.docs.length < DELETE_PAGE_SIZE) break;
      }

      results[collectionName] = { deleted, failed };
    }

    const anyFailures = Object.values(results).some((r) => r.failed > 0);
    let schoolDeleted = false;
    if (!anyFailures) {
      try {
        await enqueueWrite({ type: 'delete', collectionName: 'schools', docId: schoolId });
        schoolDeleted = true;
      } catch (err) {
        logger.error('Failed to delete school doc after dependent-collection cascade succeeded', { schoolId, error: err });
      }
    }

    logger.info('School hard-delete completed', { schoolId, results, schoolDeleted });

    res.status(200).json({ success: !anyFailures && schoolDeleted, schoolDeleted, results });
  })
);

export default router;
