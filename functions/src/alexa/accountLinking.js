// functions/src/alexa/accountLinking.js
// OAuth 2.0 for the Alexa skill — the part that answers "whose kitchen is this?"
//
// Alexa speaks OAuth 2.0 authorization code grant. Firebase Auth is not an
// OAuth *provider*: it can tell us who is signed in, but it cannot hand Amazon
// a token, and its ID tokens expire in an hour with a refresh flow that only
// the client SDKs know how to drive. So this module is a small provider of our
// own, backed by Firestore:
//
//   1. Amazon sends the cook to the app's /link/alexa page (Authorization URI).
//   2. That page — behind the normal sign-in gate — calls createAlexaAuthCode,
//      which mints a one-time code for the signed-in uid.
//   3. The page redirects back to Amazon with the code.
//   4. Amazon POSTs the code to the token endpoint and gets an access token
//      and a refresh token.
//   5. Every skill request then carries that access token, and
//      resolveAccessToken turns it back into the uid.
//
// Nothing here stores a credential it could leak: documents are keyed by the
// SHA-256 of the token, so the database holds only what an incoming token must
// hash to. A stolen export is not a set of working keys.

const crypto = require('crypto');
const { getFirestore } = require('firebase-admin/firestore');

/** Codes are redeemed by Amazon within seconds; five minutes is generous. */
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

/** Access tokens last an hour, which is what Amazon's refresh flow expects. */
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

const CODES_COLLECTION = 'alexaAuthCodes';
const TOKENS_COLLECTION = 'alexaTokens';

/**
 * Where Amazon is allowed to send the cook back to.
 *
 * An open redirect here would be an account takeover: an attacker who can name
 * the redirect URI gets the authorization code delivered to their own server.
 * Amazon publishes exactly three redirect hosts, one per region.
 */
const AMAZON_REDIRECT_HOSTS = [
  'layla.amazon.com',
  'pitangui.amazon.com',
  'alexa.amazon.co.jp',
];

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** 256 bits of randomness, URL-safe — long enough that guessing is not a plan. */
const randomToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * Compare two secrets without leaking their length or contents through timing.
 */
function secretsMatch(provided, expected) {
  const a = Buffer.from(String(provided ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Read the linking configuration from the environment.
 *
 * `configured` being false is a real deployment state — the skill's client ID
 * and secret are chosen in the Alexa developer console, so they cannot exist
 * before the skill does. Callers refuse to link rather than link to nobody.
 */
function getLinkingConfig(env = process.env) {
  const clientId = env.ALEXA_CLIENT_ID || null;
  const clientSecret = env.ALEXA_CLIENT_SECRET || null;

  // An explicit allowlist wins when it is set — the redirect URI carries a
  // vendor id that differs per skill, and a self-hosted test rig may not use
  // an amazon.com host at all.
  const allowedRedirects = String(env.ALEXA_REDIRECT_URIS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    clientId,
    clientSecret,
    allowedRedirects,
    configured: Boolean(clientId && clientSecret),
  };
}

/**
 * Is this somewhere we are willing to send an authorization code?
 */
function isAllowedRedirect(redirectUri, config = getLinkingConfig()) {
  if (!redirectUri) return false;

  if (config.allowedRedirects?.length) {
    return config.allowedRedirects.includes(String(redirectUri));
  }

  let url;
  try {
    url = new URL(String(redirectUri));
  } catch (err) {
    return false;
  }

  return url.protocol === 'https:' && AMAZON_REDIRECT_HOSTS.includes(url.hostname.toLowerCase());
}

/** Firestore hands back Timestamps; tests and fakes hand back Dates. */
function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return null;
}

/**
 * Mint a one-time authorization code for a signed-in cook.
 *
 * @param {object} options
 * @param {string} options.uid
 * @param {string} options.clientId    - as sent by Amazon, checked against ours
 * @param {string} options.redirectUri - where the code will be delivered
 * @param {object} [options.db]
 * @param {object} [options.config]
 * @param {number} [options.now]
 * @returns {Promise<{code: string, expiresAt: Date}>}
 */
async function createAuthCode({ uid, clientId, redirectUri, db, config, now = Date.now() } = {}) {
  const linking = config || getLinkingConfig();

  if (!uid) throw new Error('A signed-in user is required to link Alexa.');
  if (!linking.configured) throw new Error('Alexa account linking is not configured.');
  if (!secretsMatch(clientId, linking.clientId)) throw new Error('Unknown Alexa client.');
  if (!isAllowedRedirect(redirectUri, linking)) throw new Error('Unrecognised redirect URI.');

  const firestore = db || getFirestore();
  const code = randomToken();
  const expiresAt = new Date(now + AUTH_CODE_TTL_MS);

  await firestore
    .collection(CODES_COLLECTION)
    .doc(sha256(code))
    .set({
      uid,
      clientId: linking.clientId,
      // Stored so the token exchange can check Amazon comes back with the same
      // one, as the OAuth spec requires.
      redirectUri: String(redirectUri),
      createdAt: new Date(now),
      expiresAt,
      redeemed: false,
    });

  return { code, expiresAt };
}

/**
 * Issue an access/refresh pair for a uid.
 *
 * Refresh tokens do not expire. Amazon holds one for as long as the skill is
 * linked, and the cook revokes it by unlinking — which deletes the document,
 * which is what makes the token stop working.
 */
async function issueTokens({ uid, db, now = Date.now() } = {}) {
  const firestore = db || getFirestore();

  const accessToken = randomToken();
  const refreshToken = randomToken();
  const expiresAt = new Date(now + ACCESS_TOKEN_TTL_MS);

  const batch = firestore.batch();
  batch.set(firestore.collection(TOKENS_COLLECTION).doc(sha256(accessToken)), {
    uid,
    type: 'access',
    createdAt: new Date(now),
    expiresAt,
  });
  batch.set(firestore.collection(TOKENS_COLLECTION).doc(sha256(refreshToken)), {
    uid,
    type: 'refresh',
    createdAt: new Date(now),
    expiresAt: null,
  });
  await batch.commit();

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  };
}

/**
 * Redeem an authorization code (grant_type=authorization_code).
 *
 * The code is deleted as it is read, inside a transaction: a code that could be
 * redeemed twice is a code that can be replayed out of a browser history or a
 * proxy log.
 */
async function exchangeAuthCode({
  code,
  clientId,
  clientSecret,
  redirectUri,
  db,
  config,
  now = Date.now(),
} = {}) {
  const linking = config || getLinkingConfig();

  if (!linking.configured) throw new Error('Alexa account linking is not configured.');
  if (!secretsMatch(clientId, linking.clientId) || !secretsMatch(clientSecret, linking.clientSecret)) {
    throw new Error('invalid_client');
  }
  if (!code) throw new Error('invalid_grant');

  const firestore = db || getFirestore();
  const ref = firestore.collection(CODES_COLLECTION).doc(sha256(code));

  // The failure cases return rather than throw, because a transaction that
  // throws is rolled back in full — including the delete that burns the code
  // it just refused. Every path that rejects a code also destroys it: a code
  // that survives being rejected is one an attacker gets to keep guessing at.
  const outcome = await firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return { error: 'invalid_grant' };

    const data = snap.data();
    const expires = toMillis(data.expiresAt);

    if (data.redeemed || (expires !== null && expires <= now)) {
      transaction.delete(ref);
      return { error: 'invalid_grant' };
    }

    // The spec requires the redirect URI to match the one the code was issued
    // for, and to revoke the code when it does not: a mismatch means somebody
    // is redeeming a code that was not issued for where they are sending it.
    if (redirectUri && data.redirectUri && data.redirectUri !== String(redirectUri)) {
      transaction.delete(ref);
      return { error: 'invalid_grant' };
    }

    transaction.delete(ref);
    return { uid: data.uid };
  });

  if (outcome.error) throw new Error(outcome.error);

  return issueTokens({ uid: outcome.uid, db: firestore, now });
}

/**
 * Trade a refresh token for a new access token (grant_type=refresh_token).
 *
 * The refresh token itself is left in place: Amazon keeps using the same one,
 * and rotating it here would strand the skill on the next refresh if the
 * response were ever lost in flight.
 */
async function refreshAccessToken({ refreshToken, clientId, clientSecret, db, config, now = Date.now() } = {}) {
  const linking = config || getLinkingConfig();

  if (!linking.configured) throw new Error('Alexa account linking is not configured.');
  if (!secretsMatch(clientId, linking.clientId) || !secretsMatch(clientSecret, linking.clientSecret)) {
    throw new Error('invalid_client');
  }
  if (!refreshToken) throw new Error('invalid_grant');

  const firestore = db || getFirestore();
  const snap = await firestore.collection(TOKENS_COLLECTION).doc(sha256(refreshToken)).get();

  if (!snap.exists || snap.data().type !== 'refresh') throw new Error('invalid_grant');

  const { uid } = snap.data();
  const issued = await issueTokens({ uid, db: firestore, now });

  // Amazon already holds a refresh token that still works; handing back a
  // second one just leaves an orphan in the collection.
  await firestore.collection(TOKENS_COLLECTION).doc(sha256(issued.refresh_token)).delete();
  delete issued.refresh_token;

  return issued;
}

/**
 * Whose kitchen does this access token open?
 *
 * @returns {Promise<string|null>} the uid, or null for anything expired,
 *                                 unknown, or not an access token
 */
async function resolveAccessToken({ accessToken, db, now = Date.now() } = {}) {
  if (!accessToken) return null;

  const firestore = db || getFirestore();
  const snap = await firestore.collection(TOKENS_COLLECTION).doc(sha256(accessToken)).get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (data.type !== 'access') return null;

  const expires = toMillis(data.expiresAt);
  if (expires !== null && expires <= now) return null;

  return data.uid || null;
}

/**
 * Drop every token belonging to a cook — "unlink this skill".
 */
async function revokeTokensForUser({ uid, db } = {}) {
  if (!uid) return 0;

  const firestore = db || getFirestore();
  const snap = await firestore.collection(TOKENS_COLLECTION).where('uid', '==', uid).get();
  if (snap.empty) return 0;

  const batch = firestore.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  return snap.docs.length;
}

module.exports = {
  AUTH_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  AMAZON_REDIRECT_HOSTS,
  CODES_COLLECTION,
  TOKENS_COLLECTION,
  getLinkingConfig,
  isAllowedRedirect,
  createAuthCode,
  issueTokens,
  exchangeAuthCode,
  refreshAccessToken,
  resolveAccessToken,
  revokeTokensForUser,
  // Exported for the tests that check what actually lands in Firestore.
  sha256,
};
