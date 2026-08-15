// src/utils/imageCompression.js
// Shrinks a photo before it is uploaded — roadmap 9.2.
//
// A recipe photo taken on a modern phone is 3-6 MB and 4000px on its longest
// edge. The largest place it is ever displayed is a recipe card a few hundred
// pixels wide. Uploading the original costs the cook their data allowance, costs
// the project storage, and — because the recipe library is shared — costs every
// other person on the app the same download every time they open the recipe.
//
// This is the counterpart to `downscaleImage` in services/helloFreshApi.js,
// which does the same job for the base64 payload sent to Claude Vision. That one
// works in data URLs because that is what the API takes; this one works in Files
// because that is what `uploadBytes` takes. Both bail out unchanged rather than
// fail: a photo that is merely large is still better than no photo.

/** Longest edge we keep. 1600px covers a retina recipe card with room spare. */
export const MAX_IMAGE_EDGE = 1600;

/** JPEG quality. 0.82 is where further reduction starts to show on photos. */
export const IMAGE_QUALITY = 0.82;

/** Below this there is nothing worth doing — the re-encode could even grow it. */
export const MIN_COMPRESSIBLE_BYTES = 200 * 1024;

/**
 * Types a browser canvas can actually decode.
 *
 * HEIC is deliberately absent. Safari accepts a HEIC file from the picker but
 * cannot draw one to a canvas, so trying produces a blank image rather than an
 * error — the photo would upload as a white rectangle. Those pass through
 * untouched; the 10MB storage-rules ceiling still applies.
 */
export const COMPRESSIBLE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/** How long to wait for a decode before deciding this photo is not worth it. */
export const DECODE_TIMEOUT_MS = 5000;

/** True when compressing `file` could plausibly help. */
export const isCompressible = (file) =>
  Boolean(file) && COMPRESSIBLE_TYPES.includes(file.type) && file.size > MIN_COMPRESSIBLE_BYTES;

/** A 2D canvas, or null where there isn't one (jsdom, locked-down browsers). */
const makeCanvas = () => {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext?.('2d');
    if (!context || typeof canvas.toBlob !== 'function') return null;
    return { canvas, context };
  } catch {
    return null;
  }
};

/** Decode a File into an Image, without hanging forever on a dud. */
const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    const done = (fn) => (value) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      fn(value);
    };

    const timer = setTimeout(() => done(reject)(new Error('decode timed out')), DECODE_TIMEOUT_MS);

    img.onload = () => done(resolve)(img);
    img.onerror = () => done(reject)(new Error('decode failed'));
    img.src = url;
  });

/** Promise-shaped canvas.toBlob. */
const toBlob = (canvas, type, quality) =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

/** `photo.heic` → `photo.jpg`, so the stored name matches the stored bytes. */
export const withJpegExtension = (name = 'photo') => `${String(name).replace(/\.[^.]+$/, '')}.jpg`;

/**
 * A smaller version of `file`, or `file` itself when shrinking it would not
 * help or is not possible.
 *
 * Never rejects. Every failure mode here — no canvas, a decode that times out,
 * a re-encode that came out larger — means "upload what they gave us", which is
 * what happened before this existed.
 *
 * @param {File} file
 * @param {object} [options]
 * @param {number} [options.maxEdge]
 * @param {number} [options.quality]
 * @returns {Promise<File|Blob>} something `uploadBytes` accepts
 */
export const compressImage = async (
  file,
  { maxEdge = MAX_IMAGE_EDGE, quality = IMAGE_QUALITY } = {}
) => {
  if (!isCompressible(file)) return file;

  const surface = makeCanvas();
  if (!surface) return file;

  try {
    const img = await loadImage(file);
    const longest = Math.max(img.width || 0, img.height || 0);
    if (!longest) return file;

    const { canvas, context } = surface;
    // A photo already under the cap still gets re-encoded: a 1200px PNG
    // straight off a screenshot is routinely several MB, and the JPEG of it is
    // a tenth of that. Scale is clamped so nothing is ever enlarged.
    const scale = Math.min(1, maxEdge / longest);
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));

    // JPEG has no alpha channel, and a fresh canvas starts out transparent
    // black. Encoding a PNG that has any transparency in it therefore
    // composites every clear pixel onto *black* — a recipe card photographed
    // against a cut-out background, or a screenshot with rounded corners, came
    // back with black where the transparency was. Painting the surface white
    // first is what a cook expects to see, and costs nothing on an opaque
    // photo, which covers the fill completely.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await toBlob(canvas, 'image/jpeg', quality);
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], withJpegExtension(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified ?? undefined,
    });
  } catch (err) {
    console.warn('Could not compress that photo; uploading it as it is.', err);
    return file;
  }
};

export default compressImage;
