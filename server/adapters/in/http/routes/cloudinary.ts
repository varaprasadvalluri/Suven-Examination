import express from 'express';
import { cloudinaryUploadLimiter } from '../middleware/rateLimit';
import { requireSession } from '../middleware/requireSession';
import { asyncHandler } from '../middleware/errorHandler';
import { BadRequestError, InternalServerError } from '../../../../lib/errors';
import { cloudinaryMediaStore, deleteMediaAsset } from '../../../../composition';

const router = express.Router();

// 1. Image upload to Cloudinary (returns secure_url and public_id)
/**
 * @openapi
 * /api/cloudinary/upload:
 *   post:
 *     summary: Upload an image (base64) to Cloudinary
 *     description: Server-side upload — proxies the image through the backend rather than a signed direct upload. Requires a session. Rate-limited (cloudinaryUploadLimiter).
 *     tags: [Cloudinary]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, description: Base64-encoded image data or data URI }
 *     responses:
 *       200:
 *         description: Uploaded asset URL and public ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 secure_url: { type: string }
 *                 public_id: { type: string }
 *       400:
 *         description: Missing image data
 *       401:
 *         description: Missing or invalid session
 *       500:
 *         description: Cloudinary not configured, or upload failed
 */
router.post(
  ['/api/v1/media/cloudinary/uploads', '/api/cloudinary/upload'],
  requireSession,
  cloudinaryUploadLimiter,
  asyncHandler(async (req, res) => {
    const { image } = req.body;
    if (!image) {
      throw new BadRequestError('Missing image data');
    }

    const uploaded = await cloudinaryMediaStore.upload(image);
    return res.status(200).json({
      success: true,
      secure_url: uploaded.secureUrl,
      public_id: uploaded.publicId
    });
  })
);

// 1.5. Generate signed upload signature and parameters for direct client upload (highly secure & credit-friendly)
/**
 * @openapi
 * /api/cloudinary/sign:
 *   post:
 *     summary: Generate a signed Cloudinary upload signature for direct client-side upload
 *     description: Requires a session. Rate-limited (cloudinaryUploadLimiter). Client uses the returned signature/timestamp/api_key to upload directly to Cloudinary without the image passing through this server.
 *     tags: [Cloudinary]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Signature payload for direct client-side Cloudinary upload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 signature: { type: string }
 *                 timestamp: { type: integer }
 *                 api_key: { type: string }
 *                 cloud_name: { type: string }
 *                 folder: { type: string }
 *       401:
 *         description: Missing or invalid session
 *       500:
 *         description: Cloudinary not configured, or signing failed
 */
router.post(
  ['/api/v1/media/cloudinary/signature', '/api/cloudinary/sign'],
  requireSession,
  cloudinaryUploadLimiter,
  asyncHandler(async (req, res) => {
    const signed = cloudinaryMediaStore.signUploadRequest(Math.round(Date.now() / 1000));

    return res.status(200).json({
      success: true,
      signature: signed.signature,
      timestamp: signed.timestamp,
      api_key: signed.apiKey,
      cloud_name: signed.cloudName,
      folder: signed.folder
    });
  })
);

// 2. Direct deletion of a Cloudinary asset
/**
 * @openapi
 * /api/cloudinary/delete:
 *   post:
 *     summary: Delete a Cloudinary asset by its public ID
 *     description: Requires a session.
 *     tags: [Cloudinary]
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
 *         description: Deletion result
 *       400:
 *         description: Missing publicId
 *       401:
 *         description: Missing or invalid session
 *       500:
 *         description: Deletion failed
 */
router.post(
  ['/api/v1/media/cloudinary/deletions', '/api/cloudinary/delete'],
  requireSession,
  asyncHandler(async (req, res) => {
    const { publicId } = req.body;
    if (!publicId) {
      throw new BadRequestError('Missing publicId');
    }

    const cleanupResult = await deleteMediaAsset(publicId);
    if (cleanupResult.success) {
      return res.status(200).json({
        success: true,
        result: cleanupResult.result
      });
    } else {
      throw new InternalServerError(cleanupResult.error || 'Failed to delete Cloudinary asset');
    }
  })
);

export default router;
