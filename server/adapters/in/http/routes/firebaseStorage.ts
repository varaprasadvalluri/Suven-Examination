import express from 'express';
import { storageUploadLimiter } from '../middleware/rateLimit';
import { requireSession } from '../middleware/requireSession';
import { asyncHandler } from '../middleware/errorHandler';
import { BadRequestError, InternalServerError } from '../../../../lib/errors';
import { ALLOWED_CONTENT_TYPES } from '../../../../application/ports/MediaStore';
import { firebaseStorageMediaStore, deleteMediaAsset } from '../../../../composition';

const router = express.Router();

// 1. Issue a short-lived v4 signed URL the browser can PUT the file to directly — same
// "server signs, client uploads straight to the provider" shape as /api/cloudinary/sign,
// so no image bytes ever pass through this Node process or Firestore.
/**
 * @openapi
 * /api/storage/sign-upload:
 *   post:
 *     summary: Issue a short-lived signed URL for a direct client upload to Firebase Storage
 *     description: Requires a session. Rate-limited (storageUploadLimiter). Server never sees the file bytes — client PUTs directly to the returned uploadUrl. Signed URL expires after 5 minutes.
 *     tags: [Firebase Storage]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contentType]
 *             properties:
 *               contentType: { type: string, description: "One of: image/png, image/jpeg, image/jpg, image/gif, image/webp" }
 *     responses:
 *       200:
 *         description: Signed upload URL and the resulting object's public/download IDs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 uploadUrl: { type: string }
 *                 contentType: { type: string }
 *                 publicId: { type: string }
 *                 downloadUrl: { type: string }
 *       400:
 *         description: Unsupported or missing contentType
 *       401:
 *         description: Missing or invalid session
 *       500:
 *         description: FIREBASE_STORAGE_BUCKET not configured, or signing failed
 */
router.post(
  ['/api/v1/media/firebase/signature', '/api/storage/sign-upload'],
  requireSession,
  storageUploadLimiter,
  asyncHandler(async (req, res) => {
    const { contentType } = req.body || {};
    if (!ALLOWED_CONTENT_TYPES[contentType]) {
      throw new BadRequestError('Unsupported or missing contentType. Allowed: ' + Object.keys(ALLOWED_CONTENT_TYPES).join(', '));
    }

    const signed = await firebaseStorageMediaStore.createSignedUpload(contentType);
    return res.status(200).json({ success: true, ...signed });
  })
);

// 2. Direct deletion of a Firebase Storage object (mirrors /api/cloudinary/delete)
/**
 * @openapi
 * /api/storage/delete:
 *   post:
 *     summary: Delete a Firebase Storage object by its publicId
 *     description: Requires a session. publicId must carry the `firebase:` prefix (see FIREBASE_STORAGE_ID_PREFIX) — a non-Firebase publicId is treated as a failed cleanup, not an error.
 *     tags: [Firebase Storage]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [publicId]
 *             properties:
 *               publicId: { type: string }
 *     responses:
 *       200:
 *         description: Object deleted
 *       400:
 *         description: Missing publicId
 *       401:
 *         description: Missing or invalid session
 *       500:
 *         description: Not a Firebase Storage publicId, or deletion failed
 */
router.post(
  ['/api/v1/media/firebase/deletions', '/api/storage/delete'],
  requireSession,
  asyncHandler(async (req, res) => {
    const { publicId } = req.body || {};
    if (!publicId) {
      throw new BadRequestError('Missing publicId');
    }

    const cleanupResult = await deleteMediaAsset(publicId);
    if (cleanupResult.success) {
      return res.status(200).json({ success: true });
    }
    throw new InternalServerError(cleanupResult.error || 'Failed to delete Firebase Storage object');
  })
);

export default router;
