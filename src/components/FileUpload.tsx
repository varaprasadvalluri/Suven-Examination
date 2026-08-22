import React, { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { UploadCloud, Image, Trash2, Link as LinkIcon, AlertCircle, Sparkles, Loader2, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { authHeaders } from '../lib/sessionStore';

interface FileUploadProps {
  imageUrl?: string;
  imagePublicId?: string;
  onUploadSuccess: (url: string, publicId: string) => void;
  onDeleteSuccess: () => void;
  disabled?: boolean;
  label?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  imageUrl,
  imagePublicId,
  onUploadSuccess,
  onDeleteSuccess,
  disabled = false,
  label = 'Question Illustration / Diagram'
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state or clean preview when imageUrl is updated externally or cleared
  useEffect(() => {
    if (!imageUrl) {
      setLocalPreviewUrl(null);
    }
  }, [imageUrl]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndUploadFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndUploadFile(e.target.files[0]);
    }
  };

  const validateAndUploadFile = (file: File) => {
    if (disabled || uploadProgress !== null) return;

    // Check size limit (5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      toast.error('File is too large. Maximum size allowed is 5MB.');
      return;
    }

    // Check type limit
    if (!file.type.startsWith('image/')) {
      toast.error('Invalid file type. Please upload an image (PNG, JPG, JPEG, GIF).');
      return;
    }

    // Generate local preview immediately for "previewing images before attaching"
    const localUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(localUrl);

    // Trigger upload
    uploadFileToFirebaseStorage(file);
  };

  const uploadFileToFirebaseStorage = async (file: File) => {
    setUploadProgress(0);
    try {
      // 1. Ask the backend to mint a short-lived signed PUT URL for this exact content type.
      // No image bytes touch our server or Firestore — same "server signs, client uploads
      // straight to the provider" shape the previous Cloudinary flow used.
      const response = await fetch('/api/storage/sign-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify({ contentType: file.type })
      });

      if (!response.ok) {
        let errMsg = 'Failed to generate secure upload URL';
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errMsg = errData.error;
          }
        } catch {
          try {
            const rawText = await response.text();
            if (rawText) errMsg = rawText;
          } catch {
            // Neither JSON nor text body readable — fall through with the generic errMsg above.
          }
        }
        throw new Error(errMsg);
      }

      const signData = await response.json();
      if (!signData.success) {
        throw new Error('Failed to retrieve signed upload URL');
      }

      // 2. Perform direct PUT upload to Firebase Storage using XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();

      xhr.open('PUT', signData.uploadUrl, true);
      xhr.setRequestHeader('Content-Type', signData.contentType);

      // Track progress
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percentComplete);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          onUploadSuccess(signData.downloadUrl, signData.publicId);
          toast.success('Image uploaded securely to Firebase Storage!');
        } else {
          toast.error('Failed to upload: Firebase Storage rejected the upload (status ' + xhr.status + ')');
          setLocalPreviewUrl(null); // Clear preview on upload failure
        }
        setUploadProgress(null);
      };

      xhr.onerror = () => {
        toast.error('Network error occurred during image upload.');
        setUploadProgress(null);
        setLocalPreviewUrl(null);
      };

      xhr.send(file);
    } catch (err: any) {
      toast.error('Upload error: ' + err.message);
      console.error('Direct upload error:', err);
      setUploadProgress(null);
      setLocalPreviewUrl(null);
    }
  };

  const handleDelete = async () => {
    if (!imagePublicId) return;
    setDeleting(true);
    try {
      // Only route to the new endpoint for assets actually uploaded through it; everything
      // else (legacy Cloudinary public_ids, the 'external-url' sentinel) keeps hitting the
      // original endpoint, preserving its existing behavior for those cases unchanged.
      const isFirebaseStorageAsset = imagePublicId.startsWith('firebase:');
      const response = await fetch(isFirebaseStorageAsset ? '/api/storage/delete' : '/api/cloudinary/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify({ publicId: imagePublicId })
      });

      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to delete image');
      }

      onDeleteSuccess();
      setLocalPreviewUrl(null);
      toast.success('Image deleted from storage bucket');
    } catch (err: any) {
      toast.error('Failed to delete image: ' + err.message);
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const handleAddManualUrl = () => {
    if (!manualUrl) {
      toast.error('Please enter a valid image URL first');
      return;
    }
    if (!manualUrl.startsWith('http://') && !manualUrl.startsWith('https://')) {
      toast.error('URL must start with http:// or https://');
      return;
    }
    onUploadSuccess(manualUrl, 'external-url');
    setManualUrl('');
    toast.success('Added external diagram image URL reference!');
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Select preview image (prefers cloud image, falls back to local preview url)
  const displayUrl = imageUrl || localPreviewUrl;

  return (
    <div id="reusable-file-upload-container" className="grid gap-2">
      <Label className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
        <span className="text-sm">🖼️</span> {label}
      </Label>

      {displayUrl ? (
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-white max-w-md mx-auto shadow-md group">
            <img
              src={displayUrl}
              alt="Diagram preview"
              className="max-h-56 w-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.02]"
              referrerPolicy="no-referrer"
            />

            {/* Upload progress overlay */}
            {uploadProgress !== null && (
              <div className="absolute inset-0 bg-slate-900/60 flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-xs bg-slate-200/30 rounded-full h-2.5 overflow-hidden shadow">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <span className="text-xs font-bold text-white mt-2 animate-pulse drop-shadow">Uploading: {uploadProgress}%</span>
              </div>
            )}

            {/* Hover Actions Menu */}
            {uploadProgress === null && (
              <div className="absolute inset-0 bg-slate-900/40 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={disabled || deleting}
                  className="font-bold flex items-center gap-1.5 shadow-lg cursor-pointer"
                >
                  {deleting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Removing...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} /> Remove Image
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="text-center">
            {imagePublicId === 'external-url' ? (
              <p className="text-[10px] text-slate-500 font-medium">Using external direct image URL link reference</p>
            ) : (
              imagePublicId && (
                <p className="text-[10px] text-slate-500 font-mono">
                  {imagePublicId.startsWith('firebase:') ? 'Stored securely in Firebase Storage' : 'Stored securely on Cloudinary Cloud'}{' '}
                  (ID: <code className="bg-slate-100 px-1 py-0.5 rounded font-bold text-indigo-600">{imagePublicId}</code>)
                </p>
              )
            )}
          </div>
        </div>
      ) : (
        <div
          className={`flex flex-col items-center justify-center py-6 bg-white rounded-xl border border-dashed transition-all p-4 ${
            dragActive ? 'border-indigo-500 bg-indigo-50/40 scale-[0.99] shadow-inner' : 'border-slate-300 hover:border-slate-400'
          }`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
        >
          <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} disabled={disabled} />

          <div className="flex flex-col items-center gap-2 text-center pointer-events-none">
            <div className="p-3 bg-indigo-50 rounded-full text-indigo-600 mb-1">
              <UploadCloud size={24} className={dragActive ? 'animate-bounce' : ''} />
            </div>
            <p className="text-xs font-bold text-slate-700">Drag and drop diagram image here</p>
            <p className="text-[11px] text-slate-400">or click below to search local files (max 5MB)</p>
          </div>

          <div className="mt-4 flex flex-col items-center gap-3 w-full">
            <Button
              type="button"
              variant="outline"
              onClick={triggerFileInput}
              disabled={disabled}
              className="h-10 px-5 rounded-xl border-indigo-200 text-indigo-950 hover:bg-indigo-50 font-bold flex items-center gap-2 cursor-pointer shadow-sm transition-all"
            >
              <ImagePlus size={16} className="text-indigo-600" /> Choose Diagram File
            </Button>

            <div className="flex items-center gap-2 w-full max-w-xs px-4 mt-1">
              <div className="h-[1px] bg-slate-200 flex-1"></div>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">or paste direct image URL</span>
              <div className="h-[1px] bg-slate-200 flex-1"></div>
            </div>

            <div className="flex gap-2 w-full max-w-md px-4">
              <Input
                type="text"
                placeholder="https://example.com/diagram.png"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                disabled={disabled}
                className="flex-1 h-9 px-3 rounded-xl border border-slate-200 text-xs focus-visible:ring-indigo-500 bg-white"
              />
              <Button
                type="button"
                size="sm"
                onClick={handleAddManualUrl}
                disabled={disabled}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-9 px-3 rounded-xl cursor-pointer"
              >
                Add
              </Button>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 mt-3 text-center font-medium">
            Supports PNG, JPG, JPEG, GIF. Paste direct image link if storage upload is not available.
          </p>
        </div>
      )}
    </div>
  );
};
