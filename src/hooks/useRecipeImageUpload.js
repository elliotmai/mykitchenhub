// src/hooks/useRecipeImageUpload.js
// Uploads a recipe photo to Cloud Storage — Phase 4.3.
//
// The limits below are not decoration: firestore/storage.rules rejects anything
// larger than 10MB or outside the image content types it lists, and a rejected
// upload surfaces as an opaque "unauthorized" error. Checking client-side turns
// that into a sentence a cook can act on.
//
// Photos land under `recipes/{recipeId}/{filename}`, which the storage rules
// make readable by every signed-in user — recipes are a shared library. A new
// recipe has no id yet, so the hook mints a draft one and the caller stores the
// resulting URL on the document it then creates.

import { useState, useCallback } from 'react';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../services/firebase';
import { friendlyError } from '../utils/firebaseErrors';

/** Content types firestore/storage.rules accepts for recipe images. */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/** Maximum upload size, matching the storage rules' 10MB ceiling. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** A storage-safe file name that keeps the original extension. */
export const safeFileName = (name = 'photo.jpg') => {
  const cleaned = String(name)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-');
  return cleaned.length > 0 ? cleaned.slice(-80) : 'photo.jpg';
};

/** Id for a photo attached before its recipe document exists. */
export const draftRecipeId = () => {
  // randomUUID needs a secure context; fall back where it is unavailable.
  const webCrypto = typeof window === 'undefined' ? undefined : window.crypto;
  const random =
    typeof webCrypto?.randomUUID === 'function'
      ? webCrypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `draft-${random}`;
};

/** First problem with `file`, or null when it's safe to upload. */
export const validateImage = (file) => {
  if (!file) return 'Choose a photo first.';
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return 'That file type is not supported. Use a JPEG, PNG, WebP or HEIC photo.';
  if (file.size > MAX_IMAGE_BYTES) return 'That photo is larger than 10MB. Try a smaller one.';
  return null;
};

/**
 * useRecipeImageUpload
 *
 * const { upload, remove, uploading, error, reset } = useRecipeImageUpload();
 * const result = await upload(file);        // { success, url, path }
 */
const useRecipeImageUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const reset = useCallback(() => setError(null), []);

  const upload = useCallback(async (file, { recipeId } = {}) => {
    const problem = validateImage(file);
    if (problem) {
      setError(problem);
      return { success: false, error: problem };
    }

    setUploading(true);
    setError(null);

    const path = `recipes/${recipeId || draftRecipeId()}/${safeFileName(file.name)}`;

    try {
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);

      setUploading(false);
      return { success: true, url, path };
    } catch (err) {
      console.error('Error uploading recipe image:', err);
      // Storage answers an oversized or wrong-typed file with `unauthorized`,
      // which reads as a permissions bug; friendlyError says what to do instead.
      const message = friendlyError(err, { action: 'upload that photo' });
      setUploading(false);
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  /** Best-effort cleanup — a stale image is untidy, not broken. */
  const remove = useCallback(async (path) => {
    if (!path) return { success: false, error: 'No photo to remove.' };
    try {
      await deleteObject(ref(storage, path));
      return { success: true };
    } catch (err) {
      console.error('Error removing recipe image:', err);
      return { success: false, error: friendlyError(err, { action: 'remove that photo' }) };
    }
  }, []);

  return { upload, remove, uploading, error, reset };
};

export default useRecipeImageUpload;
