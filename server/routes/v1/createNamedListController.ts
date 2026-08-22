import express from 'express';
import { requireSession, requireRole } from '../../auth/middleware';
import { asyncHandler } from '../../middleware/errorHandler';
import { queryCache, CACHE_TTLS } from '../../db/cache';
import { BadRequestError, ConflictError } from '../../lib/errors';
import { NamedListDao } from '../../dao/createNamedListDao';

// Factory backing both SubjectCategoryController and AcademicLevelController — the two lists
// are identical in shape (flat admin-curated name list), differing only in which collection/
// cache-key/roles apply, so this is the one implementation both are built from rather than
// hand-duplicating the same three routes twice.
export function createNamedListController(opts: {
  dao: NamedListDao;
  collectionName: string;
  basePath: string;
  readRoles: string[];
  writeRoles: string[];
}) {
  const { dao, collectionName, basePath, readRoles, writeRoles } = opts;
  const router = express.Router();

  router.get(
    basePath,
    requireSession,
    requireRole(...readRoles),
    asyncHandler(async (_req, res) => {
      const cacheKey = JSON.stringify({ collectionName, constraints: [] });
      const ttl = CACHE_TTLS[collectionName] || 0;
      const cached = queryCache.get(cacheKey);
      if (ttl > 0 && cached && Date.now() - cached.timestamp < ttl) {
        return res.status(200).json({ success: true, data: cached.data, fromCache: true });
      }

      const docList = await dao.findAll();
      docList.sort((a, b) => String((a.data as any)?.name || '').localeCompare(String((b.data as any)?.name || '')));

      if (ttl > 0) {
        queryCache.set(cacheKey, { timestamp: Date.now(), data: docList });
      }
      return res.status(200).json({ success: true, data: docList });
    })
  );

  router.post(
    basePath,
    requireSession,
    requireRole(...writeRoles),
    asyncHandler(async (req: any, res) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        throw new BadRequestError('name is required.');
      }

      const existing = await dao.findAll();
      const duplicate = existing.find((doc) => String((doc.data as any)?.name || '').toLowerCase() === name.toLowerCase());
      if (duplicate) {
        throw new ConflictError(`"${name}" already exists.`);
      }

      const createdAt = new Date().toISOString();
      const result = await dao.create({ name, createdAt });
      return res.status(200).json({ success: true, data: { id: result.id, name, createdAt } });
    })
  );

  router.delete(
    `${basePath}/:id`,
    requireSession,
    requireRole(...writeRoles),
    asyncHandler(async (req: any, res) => {
      const { id } = req.params;
      await dao.deleteById(id);
      return res.status(200).json({ success: true, id });
    })
  );

  return router;
}
