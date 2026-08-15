// src/utils/firebaseErrors.js
// Turns a Firebase error into a sentence a cook can act on — roadmap 9.3.
//
// Every layer of this app used to end its catch block with `err.message`, which
// puts strings like "Missing or insufficient permissions." or
// "FirebaseError: [code=unavailable]: The operation could not be completed" in
// front of someone who just wanted to add milk to the fridge. Worse, those
// strings leak collection paths and rule names.
//
// The rule from here on: a hook never returns `err.message`. It returns
// `friendlyError(err, ...)`, and the raw error goes to the console for us.

/**
 * The bare error code, with the SDK's product prefix stripped.
 *
 * Firestore reports `permission-denied`, Storage reports `storage/unauthorized`,
 * callable Functions report `functions/permission-denied`, and Auth reports
 * `auth/wrong-password`. Normalising to the last segment lets one table cover
 * the codes that mean the same thing everywhere, while the prefixed tables below
 * still get first refusal on the ones that don't.
 */
export const errorCode = (err) => {
  const raw = typeof err === 'string' ? err : (err?.code ?? '');
  return String(raw);
};

const bareCode = (code) => (code.includes('/') ? code.slice(code.indexOf('/') + 1) : code);

/**
 * What the person was trying to do, so the message can name it.
 *
 * Callers pass a verb phrase — 'save that item', 'load your recipes'. Keeping it
 * a phrase rather than a sentence means one table of templates covers every
 * caller.
 */
const DEFAULT_ACTION = 'finish that';

/**
 * A message from one of the tables below, or undefined.
 *
 * Plain bracket access reaches Object.prototype, so an error carrying
 * `code: 'constructor'` or `code: 'toString'` — or a bare code string of the
 * same, since friendlyError accepts one — looked up a *function*, which is
 * truthy, and was handed back as the sentence to show a cook. Own properties
 * only, and only strings.
 */
const lookup = (table, key) => {
  if (!Object.prototype.hasOwnProperty.call(table, key)) return undefined;
  const message = table[key];
  return typeof message === 'string' ? message : undefined;
};

// ---------------------------------------------------------------------------
// Auth
//
// These stay separate from the shared table because the same bare code means
// something different here: `unauthenticated` from Firestore means the session
// expired, while `auth/user-not-found` means the email was wrong.
// ---------------------------------------------------------------------------
export const AUTH_ERROR_MESSAGES = {
  'auth/email-already-in-use':
    'This email is already registered. Please log in or use a different email.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/operation-not-allowed': 'Email/password accounts are not enabled. Please contact support.',
  'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
  'auth/user-disabled': 'This account has been disabled. Please contact support.',
  'auth/user-not-found': 'No account found with this email. Please sign up first.',
  'auth/wrong-password': 'Incorrect password. Please try again.',
  'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
  'auth/network-request-failed': "Couldn't reach the server. Check your connection and try again.",
  'auth/invalid-credential': 'Invalid email or password. Please try again.',
  'auth/requires-recent-login': 'Please log out and log back in to perform this action.',
  'auth/missing-password': 'Please enter your password.',
  'auth/internal-error': 'Something went wrong signing you in. Please try again.',
};

/** A sentence for a Firebase Auth error code. Never returns undefined. */
export const authErrorMessage = (code) =>
  lookup(AUTH_ERROR_MESSAGES, errorCode(code)) || 'An unexpected error occurred. Please try again.';

// ---------------------------------------------------------------------------
// Cloud Storage
//
// Photo uploads fail in their own ways — an oversized file trips the rules and
// comes back as `unauthorized`, which reads as a permissions bug unless we say
// what actually happened.
// ---------------------------------------------------------------------------
const STORAGE_MESSAGES = {
  'storage/unauthorized':
    "That photo wasn't accepted. Use a JPEG, PNG, WebP or HEIC image under 10MB.",
  'storage/canceled': 'The upload was cancelled.',
  'storage/quota-exceeded': 'There is no room left for new photos right now. Please try later.',
  'storage/retry-limit-exceeded':
    'The upload kept timing out. Check your connection and try again.',
  'storage/unauthenticated': 'Your session expired. Please sign in again.',
  'storage/object-not-found': 'That photo is no longer there — it may already have been removed.',
  'storage/invalid-checksum': 'The photo arrived damaged. Please try uploading it again.',
  'storage/server-file-wrong-size': 'The photo arrived damaged. Please try uploading it again.',
};

// ---------------------------------------------------------------------------
// Everything else — Firestore and callable Functions share gRPC status codes
// ---------------------------------------------------------------------------
const SHARED_MESSAGES = {
  cancelled: 'That was cancelled before it finished. Please try again.',
  unknown: null, // falls through to the generic template
  'invalid-argument': "Some of those details weren't valid. Please check them and try again.",
  'deadline-exceeded': 'That took too long. Check your connection and try again.',
  'not-found': "We couldn't find that — it may have been removed on another device.",
  'already-exists': 'That already exists.',
  'permission-denied': "You don't have permission to do that.",
  unauthenticated: 'Your session expired. Please sign in again.',
  'resource-exhausted': 'The kitchen is busy right now. Please wait a moment and try again.',
  'failed-precondition':
    'The app needs an update before it can do that. Please refresh and try again.',
  aborted: 'Someone changed that at the same time. Please try again.',
  'out-of-range': 'That value is outside what we can store.',
  unimplemented: "That isn't available yet.",
  internal: 'Something went wrong on our side. Please try again.',
  unavailable: "Couldn't reach the kitchen right now. Check your connection and try again.",
  'data-loss': 'Something went wrong on our side. Please try again.',
};

/**
 * A sentence for any Firebase error, from any product.
 *
 * @param {Error|string} err   the caught error, or a bare code
 * @param {object}   [options]
 * @param {string}   [options.action]   verb phrase: 'save that item'
 * @param {string}   [options.fallback] used when the code is unrecognised
 */
export const friendlyError = (err, { action = DEFAULT_ACTION, fallback } = {}) => {
  const code = errorCode(err);

  if (code.startsWith('auth/')) return authErrorMessage(code);

  const storage = lookup(STORAGE_MESSAGES, code);
  if (storage) return storage;

  const shared = lookup(SHARED_MESSAGES, bareCode(code));
  if (shared) return shared;

  // A callable Function that threw `HttpsError('recipe-not-found', 'why')`
  // wrote that message deliberately for a person to read, so it beats the
  // generic template. Two guards keep that from becoming a leak: the error must
  // carry a code at all — an uncoded `new Error(...)` is a programming slip, not
  // curated copy — and the message must not read like an SDK dump.
  const message = typeof err === 'string' ? '' : (err?.message ?? '');
  if (code && message && !looksInternal(message)) return message;

  return fallback ?? `We couldn't ${action}. Please try again.`;
};

/**
 * True when a message is SDK noise rather than something written for a person.
 *
 * The tells are a bracketed code, a `product/code` token, a stack-ish prefix, or
 * a Firestore document path — all of which mean nobody wrote it for a reader.
 */
const looksInternal = (message) => INTERNAL_TELLS.some((tell) => tell.test(message));

/**
 * The tells, one per line so each can say what it is for.
 *
 * Erring towards the generic template: a curated sentence that trips one of
 * these loses a little detail, while a raw one that slips through puts an
 * account id or a backend URL in front of someone who wanted to add milk to
 * the fridge.
 */
const INTERNAL_TELLS = [
  /FirebaseError|\[code=|firestore|firebase/i, // SDK dumps and product names
  /Missing or insufficient/i, // the rules rejection, verbatim
  /users\/[A-Za-z0-9]+\//i, // a document path
  /\bat\s+\S+\s*\(|\.js:\d+|\bat\s+\w+\.\w+/, // a stack frame, in any of its shapes
  /https?:\/\//i, // a backend URL, emulator or not
  /\b[A-Za-z0-9_-]{20,}\b/, // an opaque id: a uid is 28 characters, and no
  // sentence written for a person contains a
  // twenty-character unbroken token
];

// ---------------------------------------------------------------------------
// Retryability
// ---------------------------------------------------------------------------

/**
 * Codes worth trying again — the request failed for a reason that may not
 * still be true in a second's time.
 *
 * `permission-denied` and `invalid-argument` are deliberately absent: retrying
 * those just burns quota and delays the error the person needs to see.
 */
export const RETRYABLE_CODES = [
  'unavailable',
  'deadline-exceeded',
  'internal',
  'resource-exhausted',
  'aborted',
  'cancelled',
  'unknown',
  'storage/retry-limit-exceeded',
  'auth/network-request-failed',
];

const RETRYABLE_BARE = new Set(RETRYABLE_CODES.map(bareCode));

/** True when `err` is the kind of failure a second attempt might survive. */
export const isRetryable = (err) => {
  const code = errorCode(err);
  if (code) return RETRYABLE_BARE.has(bareCode(code));

  // Errors from `fetch` carry no code at all: a dropped connection surfaces as
  // a bare TypeError. Those are exactly the ones worth retrying.
  const message = typeof err === 'string' ? err : (err?.message ?? '');
  return /network|failed to fetch|load failed|timeout|econnreset/i.test(message);
};
