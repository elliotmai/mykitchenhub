// functions/src/board/auth.js
// Who is calling the `board` API.
//
// The caller sends `Authorization: Bearer <token>`. Only a SHA-256 hash of a
// token is ever stored. A token resolves, in this order:
//
// 1. `apiTokens/{sha256(token)}` — minted by the cook under Settings →
//    Connected apps (../apiTokens/). One `get`, no index. A revoked one is
//    refused outright; a good one has its `lastUsedAt` stamped, best-effort.
// 2. Legacy: the string field `apiTokenHash`, or one entry of the array field
//    `apiTokenHashes`, on the owner's own user document — the hand-made tokens
//    from `node functions/scripts/make-api-token.mjs`. Still honoured, so
//    tokens already in use keep working; new ones come from the screen.
//
// No token, uid or email lives in the environment. The user the token
// resolves to is the only user whose data a request can touch.
//
// The same scheme as LearnLeaf's personal API, so one habit covers both.

const { createHash } = require('node:crypto');
const admin = require('firebase-admin');

/** Shorter than this cannot be a real token (make-api-token.mjs: 43 chars; khapp_: 49). */
const MIN_TOKEN_LENGTH = 32;

/** Deliberately the same message for every failure: no hint which part was wrong. */
const UNAUTHORIZED = 'Unauthorized';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** SHA-256, hex — what is stored on the user document. */
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

/** The bearer token from an Authorization header, or '' when there is none. */
const bearerToken = (header) => {
  const value = String(header ?? '').trim();
  const match = value.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : '';
};

/**
 * A token minted under Connected apps, or null when there is no such document.
 * A revoked one is a 401, not a fall-through to the legacy fields.
 */
const resolveConnectedApp = async (db, hash) => {
  const ref = db.collection('apiTokens').doc(hash);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const token = snap.data() || {};
  if (token.revokedAt != null || typeof token.uid !== 'string' || !token.uid) {
    throw new HttpError(401, UNAUTHORIZED);
  }

  const profile = await db.collection('users').doc(token.uid).get();
  if (!profile.exists) throw new HttpError(401, UNAUTHORIZED);

  // Best-effort: not awaited, so a failed stamp never fails or delays the request.
  ref.update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() }).catch((err) => {
    console.warn('board API: could not stamp lastUsedAt:', err?.code || err?.name || 'error');
  });

  return { uid: token.uid, profile: profile.data() || {} };
};

/**
 * Resolve a request's Authorization header to the one user it belongs to.
 *
 * `apiTokens/{hash}` first. Otherwise the legacy user-document fields, which
 * refuse — 401 — unless exactly one user document matches. Zero is an unknown
 * or revoked token; two or more means the same hash was pasted onto two
 * profiles, and guessing which one was meant would hand one cook's kitchen to
 * the other.
 *
 * @param {FirebaseFirestore.Firestore} db  admin Firestore
 * @param {string} authorization            the raw header value
 * @returns {Promise<{uid: string, profile: object}>}
 */
const resolveUser = async (db, authorization) => {
  const token = bearerToken(authorization);
  if (token.length < MIN_TOKEN_LENGTH) throw new HttpError(401, UNAUTHORIZED);

  const hash = hashToken(token);

  const connected = await resolveConnectedApp(db, hash);
  if (connected) return connected;

  const users = db.collection('users');
  const [single, many] = await Promise.all([
    users.where('apiTokenHash', '==', hash).limit(2).get(),
    users.where('apiTokenHashes', 'array-contains', hash).limit(2).get(),
  ]);

  // Keyed by id: a profile carrying the hash in both fields is still one user.
  const matches = new Map([...single.docs, ...many.docs].map((doc) => [doc.id, doc]));
  if (matches.size !== 1) throw new HttpError(401, UNAUTHORIZED);

  const [doc] = matches.values();
  return { uid: doc.id, profile: doc.data() || {} };
};

module.exports = {
  MIN_TOKEN_LENGTH,
  HttpError,
  hashToken,
  bearerToken,
  resolveUser,
};
