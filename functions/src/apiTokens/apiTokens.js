// functions/src/apiTokens/apiTokens.js
// Connected apps: the signed-in cook mints, lists and revokes the API tokens
// another of their apps (Fridge Board, say) uses to call the `board` API.
//
//   listApiTokens    {}          → { tokens: [{ id, label, createdAt, lastUsedAt }] }
//   createApiToken   { label }   → { id, label, createdAt, token }
//   revokeApiToken   { id }      → { ok: true }
//
// Served at /api/<name> (netlify/functions/api-tokens.mjs), for the cook the
// Supabase access token names; nothing in a request can name another person.
//
// Tokens live in Hive's core.api_tokens (app 'kitchenhub'), keyed by
// sha256(token): the board API resolves a token with one lookup (see
// netlify/lib/kitchenAuth.mjs). The token itself is generated here, returned
// once by createApiToken, and stored nowhere. People cannot add rows to that
// table themselves; only these functions (with the service role) do.
//
// Because the key is the hash, it never goes back to the browser. The public
// id is its first 12 hex characters, and revoke resolves that against the
// caller's own tokens rather than accepting a hash from the client.
//
// `store` is the table: { owned(uid) → [{ hash, label, created_at,
// last_used_at, revoked_at }], insert(row), revoke(hash, at) }.

const { randomBytes } = require('node:crypto');

const { hashToken } = require('../board/auth');

const TOKEN_PREFIX = 'khapp_';
const MAX_ACTIVE_TOKENS = 20;
const MAX_LABEL_LENGTH = 60;
const PUBLIC_ID_LENGTH = 12;

/** An error the HTTP layer reports with a callable-style status. */
class CallableError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** `khapp_` + 32 CSPRNG bytes as base64url, no padding. */
const generateToken = () => `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;

/** The non-reversible id the browser sees. */
const publicId = (hash) => String(hash).slice(0, PUBLIC_ID_LENGTH);

const toIso = (value) => (value ? new Date(value).toISOString() : null);

/** Trimmed, 1..60 characters, or an invalid-argument the screen can show as is. */
const cleanLabel = (label) => {
  const value = typeof label === 'string' ? label.trim() : '';
  if (!value) throw new CallableError('invalid-argument', 'Give the app a name.');
  if (value.length > MAX_LABEL_LENGTH) {
    throw new CallableError(
      'invalid-argument',
      `Keep the name to ${MAX_LABEL_LENGTH} characters or fewer.`
    );
  }
  return value;
};

const requireUid = (uid) => {
  if (!uid) throw new CallableError('unauthenticated', 'Sign in to manage connected apps.');
  return uid;
};

const isActive = (row) => row.revoked_at == null;

/** Non-revoked tokens, newest first. The hash never leaves this function. */
const listTokens = async ({ store, uid }) => {
  const rows = (await store.owned(requireUid(uid))).filter(isActive);
  return rows
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((row) => ({
      id: publicId(row.hash),
      label: row.label || '',
      createdAt: toIso(row.created_at),
      lastUsedAt: toIso(row.last_used_at),
    }));
};

/** Mint one token. The plain token is in this return value and nowhere else. */
const createToken = async ({ store, uid, label, now = new Date(), newToken = generateToken }) => {
  requireUid(uid);
  const name = cleanLabel(label);
  const active = (await store.owned(uid)).filter(isActive);
  if (active.length >= MAX_ACTIVE_TOKENS) {
    throw new CallableError(
      'invalid-argument',
      `You can connect up to ${MAX_ACTIVE_TOKENS} apps. Revoke one you no longer use first.`
    );
  }

  const token = newToken();
  const hash = hashToken(token);
  await store.insert({ hash, user_id: uid, label: name, created_at: now.toISOString() });
  return { id: publicId(hash), label: name, createdAt: now.toISOString(), token };
};

/** Revoke by public id, only among the caller's own tokens. */
const revokeToken = async ({ store, uid, id, now = new Date() }) => {
  requireUid(uid);
  const wanted = typeof id === 'string' ? id.toLowerCase() : '';
  // Exactly a public id: a full hash (or anything else) is refused, not matched.
  if (!new RegExp(`^[0-9a-f]{${PUBLIC_ID_LENGTH}}$`).test(wanted)) {
    throw new CallableError('invalid-argument', 'That app id is not valid.');
  }
  const match = (await store.owned(uid)).find((row) => publicId(row.hash) === wanted);
  if (!match) throw new CallableError('not-found', 'That app is not connected.');
  // Revoking twice (a double tap) is not an error.
  if (isActive(match)) await store.revoke(match.hash, now.toISOString());
  return { ok: true };
};

/** The three requests by name, as /api/<name> answers them. */
const handlers = {
  listApiTokens: async ({ store, uid }) => ({ tokens: await listTokens({ store, uid }) }),
  createApiToken: ({ store, uid, data }) => createToken({ store, uid, label: data?.label }),
  revokeApiToken: ({ store, uid, data }) => revokeToken({ store, uid, id: data?.id }),
};

module.exports = {
  TOKEN_PREFIX,
  MAX_ACTIVE_TOKENS,
  MAX_LABEL_LENGTH,
  PUBLIC_ID_LENGTH,
  CallableError,
  generateToken,
  publicId,
  cleanLabel,
  listTokens,
  createToken,
  revokeToken,
  handlers,
};
