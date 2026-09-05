// The content types a media store will accept for upload, mapped to the file extension the
// stored object gets. On the port because it is part of the contract callers validate against,
// not an implementation detail of any one provider.
export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

export interface MediaCleanupResult {
  success: boolean;
  result?: string;
  error?: string;
}

// A place question images live. Two implementations run side by side rather than one being
// swapped for the other — assets uploaded before the Firebase Storage migration still live in
// Cloudinary — so cleanup is routed by `owns()` instead of by configuration. That routing is
// the reason this port exists: callers deleting a question no longer need to know the
// `firebase:` prefix convention to work out which provider to ask.
export interface MediaStore {
  readonly name: string;
  // True when this store is the one that holds the asset behind `publicId`.
  owns(publicId: string): boolean;
  // Deleting an asset that isn't ours, or doesn't exist, is a failed cleanup — never a throw.
  delete(publicId: string): Promise<MediaCleanupResult>;
}
