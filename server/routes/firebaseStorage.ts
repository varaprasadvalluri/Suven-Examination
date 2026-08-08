import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { firebaseConfig } from '../config';
import { storageUploadLimiter } from '../middleware/rateLimit';
import { createBreaker } from '../lib/circuitBreaker';

const router = express.Router();

const signUploadUrl = createBreaker(
  'firebaseStorage.signUpload',
  (file: ReturnType<ReturnType<typeof getBucket>['file']>, opts: any) => file.getSignedUrl(opts)
);
const deleteStorageObject = createBreaker(
  'firebaseStorage.delete',
  (file: ReturnType<ReturnType<typeof getBucket>['file']>, opts: any) => file.delete(opts)
);

// Prefix on the stored `imagePublicId` so question-delete/exam-delete cleanup (server/routes/db.ts)
// can tell a Firebase Storage object path apart from a legacy Cloudinary public_id or the
// 'external-url' sentinel, without guessing based on path shape.
export const FIREBASE_STORAGE_ID_PREFIX = 'firebase:';

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

// Same app-init pattern as server/auth/tokens.ts (one named admin app, created lazily,
// reused across requests) but with real ADC credentials since signing URLs and deleting
// objects — unlike ID-token verification — needs more than just a project ID.
let storageApp: ReturnType<typeof initializeApp> | null = null;
function getBucket() {
  if (!firebaseConfig.storageBucket) {
    throw new Error('FIREBASE_STORAGE_BUCKET is not configured. Set it in your environment (see .env.example).');
  }
  if (!storageApp) {
    storageApp = getApps().find(a => a.name === 'storage-app') || initializeApp({
      credential: applicationDefault(),
      projectId: firebaseConfig.projectId,
      storageBucket: firebaseConfig.storageBucket
    }, 'storage-app');
  }
  return getStorage(storageApp).bucket();
}

// 1. Issue a short-lived v4 signed URL the browser can PUT the file to directly — same
// "server signs, client uploads straight to the provider" shape as /api/cloudinary/sign,
// so no image bytes ever pass through this Node process or Firestore.
router.post('/api/storage/sign-upload', storageUploadLimiter, async (req, res) => {
  const { contentType } = req.body || {};
  const ext = ALLOWED_CONTENT_TYPES[contentType];
  if (!ext) {
    return res.status(400).json({ error: 'Unsupported or missing contentType. Allowed: ' + Object.keys(ALLOWED_CONTENT_TYPES).join(', ') });
  }

  try {
    const bucket = getBucket();
    const objectPath = `questions/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const file = bucket.file(objectPath);

    const [uploadUrl] = await signUploadUrl(file, {
      version: 'v4',
      action: 'write',
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes — just long enough for one upload
      contentType
    });

    return res.status(200).json({
      success: true,
      uploadUrl,
      contentType,
      publicId: FIREBASE_STORAGE_ID_PREFIX + objectPath,
      // Bucket must have public read (uniform bucket-level access + allUsers/objectViewer)
      // for this to resolve — same "publicly readable CDN link" behavior Cloudinary's
      // secure_url already gives us today. See migration notes for the one-time gsutil step.
      downloadUrl: `https://storage.googleapis.com/${bucket.name}/${objectPath}`
    });
  } catch (err: any) {
    console.error('Firebase Storage signing error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Centralized cleanup, mirrored on cleanupCloudinaryAsset in cloudinary.ts — takes the raw
// `imagePublicId` field value (i.e. still carrying the FIREBASE_STORAGE_ID_PREFIX) so callers
// in db.ts don't need to know the prefix convention.
export async function cleanupFirebaseStorageAsset(publicId: string | undefined | null): Promise<{ success: boolean; error?: string }> {
  if (!publicId || !publicId.startsWith(FIREBASE_STORAGE_ID_PREFIX)) {
    return { success: false, error: 'Not a Firebase Storage publicId' };
  }
  const objectPath = publicId.slice(FIREBASE_STORAGE_ID_PREFIX.length);
  try {
    const bucket = getBucket();
    await deleteStorageObject(bucket.file(objectPath), { ignoreNotFound: true });
    console.log(`[Firebase Storage Cleanup] Deleted object "${objectPath}"`);
    return { success: true };
  } catch (err: any) {
    console.error(`[Firebase Storage Cleanup Error] Failed to delete "${objectPath}":`, err);
    return { success: false, error: err.message || String(err) };
  }
}

// 2. Direct deletion of a Firebase Storage object (mirrors /api/cloudinary/delete)
router.post('/api/storage/delete', async (req, res) => {
  const { publicId } = req.body || {};
  if (!publicId) {
    return res.status(400).json({ error: 'Missing publicId' });
  }

  const result = await cleanupFirebaseStorageAsset(publicId);
  if (result.success) {
    return res.status(200).json({ success: true });
  }
  return res.status(500).json({ error: result.error });
});

export default router;
