// src/services/helloFreshApi.js
// The network boundary for HelloFresh import.
//
// Both Cloud Functions parse only — they hand back a draft recipe, and the
// browser saves it under the signed-in user's own credentials once the cook has
// reviewed it. That keeps the `recipes` security rules doing their job.
//
// End-to-end specs stub these two URLs with `page.route`, which is why every
// request goes through `postJson` rather than being scattered across hooks.

/** Photos are sent inline, and the Vision API caps a single image at 5MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Longest edge we send. Phone photos are far larger than a card needs. */
export const MAX_IMAGE_EDGE = 1600;

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const DEFAULT_MESSAGES = {
  'not-configured':
    'Recipe import is not set up on this build. You can still add the recipe by hand.',
  offline: 'You appear to be offline. Reconnect and try again.',
  network: 'We could not reach the import service. Try again in a moment.',
  unknown: 'Something went wrong importing that recipe. Try again.',
};

/** An import failure with a code the UI can branch on. */
export class HelloFreshImportError extends Error {
  constructor(code, message, details = []) {
    super(message || DEFAULT_MESSAGES[code] || DEFAULT_MESSAGES.unknown);
    this.name = 'HelloFreshImportError';
    this.code = code;
    this.details = details;
  }
}

/** Base URL of the deployed functions, or null when the build has none. */
export const functionsBaseUrl = () => {
  const url = process.env.REACT_APP_FIREBASE_FUNCTIONS_URL;
  return url ? url.replace(/\/+$/, '') : null;
};

/** Whether import can run at all on this build. */
export const isImportConfigured = () => functionsBaseUrl() !== null;

/** POST JSON to a function and normalise every failure into HelloFreshImportError. */
async function postJson(functionName, payload) {
  const base = functionsBaseUrl();
  if (!base) throw new HelloFreshImportError('not-configured');

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new HelloFreshImportError('offline');
  }

  let response;
  try {
    response = await fetch(`${base}/${functionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new HelloFreshImportError('network');
  }

  let body = null;
  try {
    body = await response.json();
  } catch (err) {
    body = null;
  }

  if (!response.ok || body?.status === 'error') {
    throw new HelloFreshImportError(
      body?.code ?? 'unknown',
      body?.message,
      Array.isArray(body?.details) ? body.details : []
    );
  }

  if (!body?.recipe) throw new HelloFreshImportError('unknown');

  return { recipe: body.recipe, warnings: Array.isArray(body.warnings) ? body.warnings : [] };
}

/** Read a File into a data: URL. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () =>
      reject(new HelloFreshImportError('unreadable-image', 'That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** How long to wait for a photo to decode before giving up on resizing it. */
export const DECODE_TIMEOUT_MS = 5000;

/** Load a data: URL into an Image element, without hanging forever on a dud. */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('decode timed out')), DECODE_TIMEOUT_MS);

    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('decode failed'));
    };
    img.src = dataUrl;
  });
}

/** A 2D canvas, or null where there isn't one (jsdom, locked-down browsers). */
function makeCanvas() {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext?.('2d');
    if (!context || typeof canvas.toDataURL !== 'function') return null;
    return { canvas, context };
  } catch (err) {
    return null;
  }
}

/**
 * Shrink an oversized photo before sending it.
 *
 * Returns the original data URL untouched when the image is already small
 * enough, or when there is no working canvas — the size guard in
 * `readImageFile` still protects the request either way. The canvas check comes
 * first deliberately: without one there is nothing to gain from decoding the
 * image, and decoding is the slow, hang-prone half.
 */
export async function downscaleImage(dataUrl, maxEdge = MAX_IMAGE_EDGE) {
  const surface = makeCanvas();
  if (!surface) return dataUrl;

  try {
    const img = await loadImage(dataUrl);
    const longest = Math.max(img.width || 0, img.height || 0);
    if (!longest || longest <= maxEdge) return dataUrl;

    const { canvas, context } = surface;
    const scale = maxEdge / longest;
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);

    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const resized = canvas.toDataURL('image/jpeg', 0.85);

    // A canvas stub can return something unusable; only take a real improvement.
    return resized && resized.length < dataUrl.length ? resized : dataUrl;
  } catch (err) {
    return dataUrl;
  }
}

/** Decoded byte length of a base64 payload. */
export const base64ByteLength = (data) =>
  Math.floor((String(data ?? '').replace(/=+$/, '').length * 3) / 4);

/**
 * Turn a picked or captured file into the payload the function expects.
 *
 * @returns {Promise<{ image: string, mediaType: string, dataUrl: string }>}
 */
export async function readImageFile(file) {
  if (!file) {
    throw new HelloFreshImportError('unreadable-image', 'No photo was selected.');
  }

  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    throw new HelloFreshImportError(
      'unreadable-image',
      'Photos need to be a JPEG, PNG, GIF, or WebP image.'
    );
  }

  const original = await readAsDataUrl(file);
  const dataUrl = await downscaleImage(original);

  const [, base64 = ''] = dataUrl.split(',');
  if (!base64) {
    throw new HelloFreshImportError('unreadable-image', 'That photo could not be read.');
  }

  if (base64ByteLength(base64) > MAX_IMAGE_BYTES) {
    throw new HelloFreshImportError(
      'unreadable-image',
      'That photo is too large. Take it again at a lower resolution.'
    );
  }

  return { image: base64, mediaType: file.type, dataUrl };
}

/**
 * Send a recipe-card photo to Claude Vision.
 *
 * @returns {Promise<{ recipe: object, warnings: string[] }>}
 */
export const importFromPhoto = ({ image, mediaType }) =>
  postJson('importHelloFreshFromPhoto', { image, mediaType });

/**
 * Scrape a HelloFresh recipe page.
 *
 * @returns {Promise<{ recipe: object, warnings: string[] }>}
 */
export const importFromUrl = (url) =>
  postJson('importHelloFreshFromUrl', { url: String(url ?? '').trim() });

/** Client-side pre-check so an obviously wrong link never leaves the browser. */
export const looksLikeHelloFreshUrl = (value) => {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return /(^|\.)hellofresh\.(?:com|co\.uk|com\.au|co\.nz|de|nl|be|fr|ca|se|dk|no|ch|at|it|es|lu|ie|jp)$/i.test(
      url.hostname
    );
  } catch (err) {
    return false;
  }
};
