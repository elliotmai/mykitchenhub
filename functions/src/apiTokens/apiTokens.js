// functions/src/apiTokens/apiTokens.js
// Connected apps: the signed-in cook mints, lists and revokes the API tokens
// another of their apps (Fridge Board, say) uses to call the `board` API.
//
//   listApiTokens    {}          → { tokens: [{ id, label, createdAt, lastUsedAt }] }
//   createApiToken   { label }   → { id, label, createdAt, token }
//   revokeApiToken   { id }      → { ok: true }
//
// Callables, so Firebase verifies the caller's ID token and every call acts on
// `context.auth.uid` alone — nothing in a request can name another user.
//
// Storage is `apiTokens/{sha256(token)}`: the document id IS the hash, so the
// API resolves a token with one `get` (see ../board/auth.js). The token itself
// is generated here, returned once by createApiToken, and stored nowhere. The
// security rules deny the client every read and write on `apiTokens/**`; only
// these functions and the board API touch it, through the admin SDK.
//
// Because the id is the hash, it never goes back to the browser. The public id
// is its first 12 hex characters, and revoke resolves that against the
// caller's own tokens rather than accepting a hash from the client.

const { randomBytes } = require('node:crypto');
const functions = require('firebase-functions');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const { hashToken } = require('../board/auth');

const COLLECTION = 'apiTokens';
const TOKEN_PREFIX = 'khapp_';
const MAX_ACTIVE_TOKENS = 20;
const MAX_LABEL_LENGTH = 60;
const PUBLIC_ID_LENGTH = 12;

const { HttpsError } = functions.https;

/** `khapp_` + 32 CSPRNG bytes as base64url, no padding. */
const generateToken = () => `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;

/** The non-reversible id the browser sees. */
const publicId = (hash) => String(hash).slice(0, PUBLIC_ID_LENGTH);

/** Firestore Timestamp (or Date) → ISO string, which survives the callable's JSON. */
const toIso = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
};

const millis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
};

/** Trimmed, 1..60 characters, or an invalid-argument the screen can show as is. */
const cleanLabel = (label) => {
  const value = typeof label === 'string' ? label.trim() : '';
  if (!value) throw new HttpsError('invalid-argument', 'Give the app a name.');
  if (value.length > MAX_LABEL_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `Keep the name to ${MAX_LABEL_LENGTH} characters or fewer.`
    );
  }
  return value;
};

const requireUid = (context) => {
  const uid = context?.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage connected apps.');
  return uid;
};

/** Every token document the user owns, revoked ones included. */
const ownedTokens = async (db, uid) => {
  const snap = await db.collection(COLLECTION).where('uid', '==', uid).get();
  return snap.docs;
};

const isActive = (doc) => (doc.data() || {}).revokedAt == null;

/** Non-revoked tokens, newest first. The hash never leaves this function. */
const listTokens = async ({ db, uid }) => {
  const docs = (await ownedTokens(db, uid)).filter(isActive);
  return docs
    .map((doc) => ({ hash: doc.id, data: doc.data() || {} }))
    .sort((a, b) => millis(b.data.createdAt) - millis(a.data.createdAt))
    .map(({ hash, data }) => ({
      id: publicId(hash),
      label: data.label || '',
      createdAt: toIso(data.createdAt),
      lastUsedAt: toIso(data.lastUsedAt),
    }));
};

/** Mint one token. The plain token is in this return value and nowhere else. */
const createToken = async ({ db, uid, label, now = new Date(), newToken = generateToken }) => {
  const name = cleanLabel(label);

  const active = (await ownedTokens(db, uid)).filter(isActive);
  if (active.length >= MAX_ACTIVE_TOKENS) {
    throw new HttpsError(
      'invalid-argument',
      `You can connect up to ${MAX_ACTIVE_TOKENS} apps. Revoke one you no longer use first.`
    );
  }

  const token = newToken();
  const hash = hashToken(token);
  const createdAt = Timestamp.fromDate(now);

  await db.collection(COLLECTION).doc(hash).set({
    uid,
    label: name,
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
  });

  return { id: publicId(hash), label: name, createdAt: toIso(createdAt), token };
};

/** Revoke by public id, only among the caller's own tokens. */
const revokeToken = async ({ db, uid, id, now = new Date() }) => {
  const wanted = typeof id === 'string' ? id.toLowerCase() : '';
  // Exactly a public id: a full hash (or anything else) is refused, not matched.
  if (!new RegExp(`^[0-9a-f]{${PUBLIC_ID_LENGTH}}$`).test(wanted)) {
    throw new HttpsError('invalid-argument', 'That app id is not valid.');
  }

  const docs = await ownedTokens(db, uid);
  const match = docs.find((doc) => publicId(doc.id) === wanted);
  if (!match) throw new HttpsError('not-found', 'That app is not connected.');

  // Revoking twice (a double tap) is not an error.
  if (isActive(match)) {
    await db
      .collection(COLLECTION)
      .doc(match.id)
      .update({ revokedAt: Timestamp.fromDate(now) });
  }
  return { ok: true };
};

/** Wraps a handler: auth, then HttpsErrors through, anything else as `internal`. */
const callable = (name, handler) =>
  functions.https.onCall(async (data, context) => {
    const uid = requireUid(context);
    try {
      return await handler({ db: getFirestore(), uid, data: data || {} });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error(`${name} failed:`, err?.code || err?.name || 'error');
      throw new HttpsError('internal', 'Something went wrong. Please try again.');
    }
  });

const listApiTokens = callable('listApiTokens', async ({ db, uid }) => ({
  tokens: await listTokens({ db, uid }),
}));

const createApiToken = callable('createApiToken', ({ db, uid, data }) =>
  createToken({ db, uid, label: data.label })
);

const revokeApiToken = callable('revokeApiToken', ({ db, uid, data }) =>
  revokeToken({ db, uid, id: data.id })
);

module.exports = {
  COLLECTION,
  TOKEN_PREFIX,
  MAX_ACTIVE_TOKENS,
  MAX_LABEL_LENGTH,
  PUBLIC_ID_LENGTH,
  generateToken,
  hashToken,
  publicId,
  cleanLabel,
  listTokens,
  createToken,
  revokeToken,
  listApiTokens,
  createApiToken,
  revokeApiToken,
};
