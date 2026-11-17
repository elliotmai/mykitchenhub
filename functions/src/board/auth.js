// functions/src/board/auth.js
// Who is calling the `board` API.
//
// The caller sends `Authorization: Bearer <token>`. Only a SHA-256 hash of a
// token is ever stored, on the owner's own user document: either the string
// field `apiTokenHash`, or one entry of the array field `apiTokenHashes` (one
// per connected app, so each can be revoked on its own). The user whose
// document carries the hash is the only user whose data a request can touch.
//
// No token, uid or email lives in the environment. Generate a token and its
// hash with `node functions/scripts/make-api-token.mjs`; revoke one by deleting
// its field or array entry in the Firebase console.
//
// The same scheme as LearnLeaf's personal API, so one habit covers both.

const { createHash } = require('node:crypto');

/** Shorter than this cannot have come from make-api-token.mjs (43 chars). */
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
 * Resolve a request's Authorization header to the one user it belongs to.
 *
 * Refuses — 401 — unless exactly one user document matches. Zero is an
 * unknown or revoked token; two or more means the same hash was pasted onto
 * two profiles, and guessing which one was meant would hand one cook's kitchen
 * to the other.
 *
 * @param {FirebaseFirestore.Firestore} db  admin Firestore
 * @param {string} authorization            the raw header value
 * @returns {Promise<{uid: string, profile: object}>}
 */
const resolveUser = async (db, authorization) => {
  const token = bearerToken(authorization);
  if (token.length < MIN_TOKEN_LENGTH) throw new HttpError(401, UNAUTHORIZED);

  const hash = hashToken(token);
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
