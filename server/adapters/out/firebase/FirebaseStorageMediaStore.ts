import crypto from 'crypto';
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { firebaseConfig } from '../../../config';
import { MediaStore, MediaCleanupResult, ALLOWED_CONTENT_TYPES } from '../../../application/ports/MediaStore';
import { createBreaker } from '../../../lib/circuitBreaker';
import { logger } from '../../../lib/logger';

const signUploadUrl = createBreaker('firebaseStorage.signUpload', (file: any, opts: any) => file.getSignedUrl(opts));
const deleteStorageObject = createBreaker('firebaseStorage.delete', (file: any, opts: any) => file.delete(opts));

// Prefix on the stored `imagePublicId` so question-delete/exam-delete cleanup can tell a
// Firebase Storage object path apart from a legacy Cloudinary public_id or the 'external-url'
// sentinel, without guessing based on path shape.
export const FIREBASE_STORAGE_ID_PREFIX = 'firebase:';

// Just long enough for one upload.
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

export interface SignedUpload {
  uploadUrl: string;
  contentType: string;
  publicId: string;
  downloadUrl: string;
}

export class FirebaseStorageMediaStore implements MediaStore {
  readonly name = 'firebase-storage';
  // Same app-init pattern as FirebaseTokenVerifier (one named admin app, created lazily,
  // reused across requests) but with real ADC credentials since signing URLs and deleting
  // objects — unlike ID-token verification — needs more than just a project ID.
  private storageApp: ReturnType<typeof initializeApp> | null = null;

  private getBucket() {
    if (!firebaseConfig.storageBucket) {
      throw new Error('FIREBASE_STORAGE_BUCKET is not configured. Set it in your environment (see .env.example).');
    }
    if (!this.storageApp) {
      this.storageApp =
        getApps().find((a) => a.name === 'storage-app') ||
        initializeApp(
          {
            credential: applicationDefault(),
            projectId: firebaseConfig.projectId,
            storageBucket: firebaseConfig.storageBucket
          },
          'storage-app'
        );
    }
    return getStorage(this.storageApp).bucket();
  }

  owns(publicId: string): boolean {
    return !!publicId && publicId.startsWith(FIREBASE_STORAGE_ID_PREFIX);
  }

  // Issues a short-lived v4 signed URL the browser can PUT the file to directly — same
  // "server signs, client uploads straight to the provider" shape as the Cloudinary
  // signature, so no image bytes ever pass through this Node process.
  async createSignedUpload(contentType: string): Promise<SignedUpload> {
    const ext = ALLOWED_CONTENT_TYPES[contentType];
    if (!ext) {
      throw new Error('Unsupported or missing contentType. Allowed: ' + Object.keys(ALLOWED_CONTENT_TYPES).join(', '));
    }

    const bucket = this.getBucket();
    const objectPath = `questions/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const file = bucket.file(objectPath);

    const [uploadUrl] = await signUploadUrl(file, {
      version: 'v4',
      action: 'write',
      expires: Date.now() + SIGNED_URL_TTL_MS,
      contentType
    });

    return {
      uploadUrl,
      contentType,
      publicId: FIREBASE_STORAGE_ID_PREFIX + objectPath,
      // Bucket must have public read (uniform bucket-level access + allUsers/objectViewer)
      // for this to resolve — same "publicly readable CDN link" behavior Cloudinary's
      // secure_url already gives us today. See migration notes for the one-time gsutil step.
      downloadUrl: `https://storage.googleapis.com/${bucket.name}/${objectPath}`
    };
  }

  async delete(publicId: string): Promise<MediaCleanupResult> {
    if (!this.owns(publicId)) {
      return { success: false, error: 'Not a Firebase Storage publicId' };
    }
    const objectPath = publicId.slice(FIREBASE_STORAGE_ID_PREFIX.length);
    try {
      const bucket = this.getBucket();
      await deleteStorageObject(bucket.file(objectPath), { ignoreNotFound: true });
      logger.info('Firebase Storage object deleted', { objectPath });
      return { success: true };
    } catch (err: any) {
      logger.error('Firebase Storage object delete failed', { objectPath, err });
      return { success: false, error: err.message || String(err) };
    }
  }
}

export const firebaseStorageMediaStore = new FirebaseStorageMediaStore();
