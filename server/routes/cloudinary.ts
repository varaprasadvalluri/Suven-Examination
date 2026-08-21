import express from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryUploadLimiter } from '../middleware/rateLimit';
import { createBreaker } from '../lib/circuitBreaker';
import { requireSession } from '../auth/middleware';

const router = express.Router();

const uploadToCloudinary = createBreaker('cloudinary.upload', (cld: typeof cloudinary, image: string) =>
  cld.uploader.upload(image, { folder: 'suven_exams', resource_type: 'auto' })
);
const destroyCloudinaryAsset = createBreaker('cloudinary.destroy', (cld: typeof cloudinary, publicId: string) =>
  cld.uploader.destroy(publicId)
);

// CLOUDINARY CONFIGURATION & UTILS
function cleanEnvValue(val: string | undefined): string {
  if (!val) return '';
  let cleaned = val.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}

let isCloudinaryConfigured = false;
function getCloudinary() {
  const cloudName = cleanEnvValue(process.env.CLOUDINARY_CLOUD_NAME);
  const apiKey = cleanEnvValue(process.env.CLOUDINARY_API_KEY);
  const apiSecret = cleanEnvValue(process.env.CLOUDINARY_API_SECRET);

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Cloudinary environment variables (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are required but missing. Please configure them in your settings.'
    );
  }

  if (apiSecret.includes('*') || apiSecret.toLowerCase() === 'your_secret' || apiSecret.toLowerCase() === 'your_secret_here') {
    throw new Error(
      'Cloudinary API Secret is set to a masked or placeholder value (e.g. "**********"). This typically happens if the masked asterisk dots were copied from your Cloudinary dashboard instead of clicking the "Reveal" button first, or if placeholder settings were used. Please open your AI Studio Settings (Environment Variables), copy the actual raw, unmasked API Secret from your Cloudinary Dashboard, and save it there.'
    );
  }

  if (!isCloudinaryConfigured) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true
    });
    isCloudinaryConfigured = true;
  }
  return cloudinary;
}

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
router.post('/api/cloudinary/upload', requireSession, cloudinaryUploadLimiter, async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  try {
    const cld = getCloudinary();
    const uploadResult = await uploadToCloudinary(cld, image);
    return res.status(200).json({
      success: true,
      secure_url: uploadResult.secure_url,
      public_id: uploadResult.public_id
    });
  } catch (err: any) {
    console.error('Cloudinary upload error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

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
router.post('/api/cloudinary/sign', requireSession, cloudinaryUploadLimiter, async (req, res) => {
  try {
    const cld = getCloudinary();
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = 'suven_exams';

    const cloudName = cleanEnvValue(process.env.CLOUDINARY_CLOUD_NAME);
    const apiKey = cleanEnvValue(process.env.CLOUDINARY_API_KEY);
    const apiSecret = cleanEnvValue(process.env.CLOUDINARY_API_SECRET);

    console.log(`[CLOUDINARY SIGN DEBUG]`, {
      cloudName: cloudName ? `${cloudName.slice(0, 3)}... (len: ${cloudName.length})` : 'MISSING',
      apiKey: apiKey ? `${apiKey.slice(0, 3)}... (len: ${apiKey.length})` : 'MISSING',
      apiSecret: apiSecret ? `${apiSecret.slice(0, 3)}...${apiSecret.slice(-3)} (len: ${apiSecret.length})` : 'MISSING',
      timestamp,
      folder
    });

    // Define standard signature parameters
    const paramsToSign = {
      timestamp: timestamp,
      folder: folder
    };

    if (!apiSecret) {
      throw new Error('Cloudinary API Secret key is not configured in settings.');
    }

    // Generate cryptographic signature on the server using API secret key
    const signature = cld.utils.api_sign_request(paramsToSign, apiSecret);

    return res.status(200).json({
      success: true,
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      folder
    });
  } catch (err: any) {
    console.error('Cloudinary signing error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// 1.9. Helper function to clean up Cloudinary assets when questions or exams are deleted
/**
 * Centralized cleanup function to delete a Cloudinary asset by its public ID.
 * This is triggered during question/exam deletion to prevent orphaned assets and keep storage usage within free limits.
 */
export async function cleanupCloudinaryAsset(
  publicId: string | undefined | null
): Promise<{ success: boolean; result?: string; error?: string }> {
  if (!publicId || publicId === 'external-url') {
    return { success: false, error: 'No valid Cloudinary publicId provided' };
  }
  try {
    const cld = getCloudinary();
    const destroyResult = await destroyCloudinaryAsset(cld, publicId);
    console.log(`[Cloudinary Cleanup] Deleted asset "${publicId}". Status:`, destroyResult);
    return { success: true, result: destroyResult.result };
  } catch (err: any) {
    console.error(`[Cloudinary Cleanup Error] Failed to delete asset "${publicId}":`, err);
    return { success: false, error: err.message || String(err) };
  }
}

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
router.post('/api/cloudinary/delete', requireSession, async (req, res) => {
  const { publicId } = req.body;
  if (!publicId) {
    return res.status(400).json({ error: 'Missing publicId' });
  }

  try {
    const cleanupResult = await cleanupCloudinaryAsset(publicId);
    if (cleanupResult.success) {
      return res.status(200).json({
        success: true,
        result: cleanupResult.result
      });
    } else {
      return res.status(500).json({ error: cleanupResult.error });
    }
  } catch (err: any) {
    console.error('Cloudinary delete route error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
