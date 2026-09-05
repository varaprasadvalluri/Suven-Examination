import { v2 as cloudinary } from 'cloudinary';
import { MediaStore, MediaCleanupResult } from '../../../application/ports/MediaStore';
import { createBreaker } from '../../../lib/circuitBreaker';
import { logger } from '../../../lib/logger';

const uploadToCloudinary = createBreaker('cloudinary.upload', (cld: typeof cloudinary, image: string) =>
  cld.uploader.upload(image, { folder: 'suven_exams', resource_type: 'auto' })
);
const destroyCloudinaryAsset = createBreaker('cloudinary.destroy', (cld: typeof cloudinary, publicId: string) =>
  cld.uploader.destroy(publicId)
);

const UPLOAD_FOLDER = 'suven_exams';

// Env values are read through this because the AI Studio settings UI round-trips them with
// surrounding quotes often enough that a raw process.env read silently produces a bad secret.
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

export interface CloudinarySignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
}

export class CloudinaryMediaStore implements MediaStore {
  readonly name = 'cloudinary';
  private configured = false;

  private credentials() {
    return {
      cloudName: cleanEnvValue(process.env.CLOUDINARY_CLOUD_NAME),
      apiKey: cleanEnvValue(process.env.CLOUDINARY_API_KEY),
      apiSecret: cleanEnvValue(process.env.CLOUDINARY_API_SECRET)
    };
  }

  private getClient() {
    const { cloudName, apiKey, apiSecret } = this.credentials();

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

    if (!this.configured) {
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
      this.configured = true;
    }
    return cloudinary;
  }

  // Cloudinary public_ids carry no prefix of their own, so anything that isn't claimed by a
  // more specific store — and isn't the 'external-url' sentinel — is treated as Cloudinary's.
  owns(publicId: string): boolean {
    return !!publicId && publicId !== 'external-url' && !publicId.startsWith('firebase:');
  }

  // Server-side upload — proxies the image through the backend rather than a signed direct
  // upload. Kept for callers that can't do the two-step signed flow.
  async upload(image: string): Promise<{ secureUrl: string; publicId: string }> {
    const result = await uploadToCloudinary(this.getClient(), image);
    return { secureUrl: result.secure_url, publicId: result.public_id };
  }

  // Lets the browser upload straight to Cloudinary — no image bytes through this process.
  signUploadRequest(timestamp: number): CloudinarySignature {
    const client = this.getClient();
    const { cloudName, apiKey, apiSecret } = this.credentials();

    logger.info('Cloudinary signing request', {
      cloudName: cloudName ? `${cloudName.slice(0, 3)}... (len: ${cloudName.length})` : 'MISSING',
      apiKey: apiKey ? `${apiKey.slice(0, 3)}... (len: ${apiKey.length})` : 'MISSING',
      apiSecret: apiSecret ? `${apiSecret.slice(0, 3)}...${apiSecret.slice(-3)} (len: ${apiSecret.length})` : 'MISSING',
      timestamp,
      folder: UPLOAD_FOLDER
    });

    if (!apiSecret) {
      throw new Error('Cloudinary API Secret key is not configured in settings.');
    }

    const signature = client.utils.api_sign_request({ timestamp, folder: UPLOAD_FOLDER }, apiSecret);
    return { signature, timestamp, apiKey, cloudName, folder: UPLOAD_FOLDER };
  }

  async delete(publicId: string): Promise<MediaCleanupResult> {
    if (!this.owns(publicId)) {
      return { success: false, error: 'No valid Cloudinary publicId provided' };
    }
    try {
      const destroyResult = await destroyCloudinaryAsset(this.getClient(), publicId);
      logger.info('Cloudinary asset deleted', { publicId, destroyResult });
      return { success: true, result: destroyResult.result };
    } catch (err: any) {
      logger.error('Cloudinary asset delete failed', { publicId, err });
      return { success: false, error: err.message || String(err) };
    }
  }
}

export const cloudinaryMediaStore = new CloudinaryMediaStore();
