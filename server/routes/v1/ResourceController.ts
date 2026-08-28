import express from 'express';
import { requireSession } from '../../auth/middleware';
import { checkDuplicateSubmission } from '../../middleware/duplicateSubmission';
import { handleCollectionQuery, handleCollectionWrite } from '../db';
import { COLLECTION_ACCESS, PUBLIC_READ_COLLECTIONS } from '../../authorization';
import { BadRequestError } from '../../lib/errors';

const router = express.Router();

// RESOURCE-SHAPED URLs FOR THE COLLECTIONS THAT HAVE NO DEDICATED CONTROLLER YET.
//
// `POST /api/db/query` and `POST /api/db/write` described the mechanism (a database proxy)
// rather than the thing being acted on, so every URL in the app looked identical no matter
// whether a student was submitting an exam or an admin was editing a school. These routes put
// the resource back in the URL — `/api/v1/attempts/edu-att-123`, `/api/v1/schools` — while
// delegating to the exact same handlers, so the ACL, tenant scoping, caching, answer-key
// sanitization and write-batching are shared rather than reimplemented.
//
// MOUNT ORDER MATTERS. This router is registered LAST in server.ts, after every named
// controller, because `/:resource` would otherwise shadow `/api/v1/schools`,
// `/api/v1/attempts` and friends. Express matches in registration order, so the specific
// controllers win and this catches only what they don't handle. As collections graduate to
// their own controller they simply stop reaching this file.
//
// Why search is a POST: a query here can carry an arbitrary list of where/orderBy/limit
// constraints. Encoding that into a query string is fragile and runs into URL length limits,
// so the constraint document goes in the body — the same pattern GitHub and Elasticsearch use
// for complex search. It is still a read: nothing is mutated.

// Guard the wildcard. Without this, `:resource` would accept any string and hand it to the
// query layer, which is a wider door than the ACL was written to stand behind.
const KNOWN_COLLECTIONS = new Set([...Object.keys(COLLECTION_ACCESS), ...PUBLIC_READ_COLLECTIONS]);

function assertKnownCollection(resource: string) {
  if (!KNOWN_COLLECTIONS.has(resource)) {
    throw new BadRequestError(`Unknown resource "${resource}".`);
  }
}

// Adapts REST-shaped params into the { collectionName, docId, ... } envelope the shared
// handlers already expect, so neither handler needed to change.
function asQuery(req: any, extra: Record<string, unknown> = {}) {
  assertKnownCollection(req.params.resource);
  req.body = { ...(req.body || {}), collectionName: req.params.resource, ...extra };
}

function asWrite(req: any, type: 'add' | 'set' | 'update' | 'delete') {
  assertKnownCollection(req.params.resource);
  req.body = {
    type,
    collectionName: req.params.resource,
    docId: req.params.id,
    data: req.body?.data ?? req.body
  };
}

/**
 * @openapi
 * /api/v1/{resource}/search:
 *   post:
 *     summary: Query a collection that has no dedicated controller yet
 *     description: >
 *       Resource-shaped replacement for POST /api/db/query. Public collections need no session;
 *       everything else requires one and is checked against COLLECTION_ACCESS for the caller's
 *       role, then tenant-scoped automatically. A read, despite being a POST — the constraint
 *       document goes in the body because it cannot be encoded safely in a query string.
 *     tags: [Resources]
 *     parameters:
 *       - in: path
 *         name: resource
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Query result }
 *       400: { description: Unknown resource }
 *       403: { description: Caller's role may not read this collection }
 */
router.post(
  '/api/v1/:resource/search',
  (req, _res, next) => {
    asQuery(req);
    next();
  },
  handleCollectionQuery
);

/**
 * @openapi
 * /api/v1/{resource}/count:
 *   post:
 *     summary: Count matching documents without fetching them
 *     tags: [Resources]
 *     responses:
 *       200: { description: "{ count }" }
 */
router.post(
  '/api/v1/:resource/count',
  (req, _res, next) => {
    asQuery(req, { countOnly: true });
    next();
  },
  handleCollectionQuery
);

/**
 * @openapi
 * /api/v1/{resource}/{id}:
 *   get:
 *     summary: Fetch a single document by id
 *     tags: [Resources]
 *     responses:
 *       200: { description: The document }
 *       404: { description: Not found }
 */
router.get(
  '/api/v1/:resource/:id',
  (req, _res, next) => {
    asQuery(req, { docId: req.params.id });
    next();
  },
  handleCollectionQuery
);

/**
 * @openapi
 * /api/v1/{resource}:
 *   post:
 *     summary: Create a document, letting the server assign its id
 *     tags: [Resources]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, id }" }
 *       403: { description: authorizeWrite denied this write }
 */
router.post(
  '/api/v1/:resource',
  requireSession,
  (req, _res, next) => {
    asWrite(req, 'add');
    next();
  },
  handleCollectionWrite
);

/**
 * @openapi
 * /api/v1/{resource}/{id}:
 *   put:
 *     summary: Create or replace a document at a known id
 *     tags: [Resources]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, id }" }
 */
router.put(
  '/api/v1/:resource/:id',
  requireSession,
  (req, _res, next) => {
    asWrite(req, 'set');
    next();
  },
  // Runs on set/update of an attempt carrying status:'completed' — the exam-submission path
  // reaches the same duplicate guard here as it does through the legacy route.
  checkDuplicateSubmission,
  handleCollectionWrite
);

/**
 * @openapi
 * /api/v1/{resource}/{id}:
 *   patch:
 *     summary: Partially update a document
 *     tags: [Resources]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, id }" }
 */
router.patch(
  '/api/v1/:resource/:id',
  requireSession,
  (req, _res, next) => {
    asWrite(req, 'update');
    next();
  },
  checkDuplicateSubmission,
  handleCollectionWrite
);

/**
 * @openapi
 * /api/v1/{resource}/{id}:
 *   delete:
 *     summary: Delete a document
 *     tags: [Resources]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, id }" }
 */
router.delete(
  '/api/v1/:resource/:id',
  requireSession,
  (req, _res, next) => {
    asWrite(req, 'delete');
    next();
  },
  handleCollectionWrite
);

export default router;
