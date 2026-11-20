// functions/src/hive/hiveExchange.js
// Sign in with Hive: trade a Hive pass for a KitchenHub sign-in.
//
// Hive (hive.flyingdoublemranch.com) vouches for the person signed in to it
// with a two-minute pass made for "kitchenhub" (see ../board/hivePass.js).
// The page posts it here; we find the KitchenHub account with that confirmed
// email and answer with a Firebase custom token, which the page signs in with.
// Nobody types a password, and no key is stored outside Firebase: Cloud
// Functions sign the token with the project's own service account.
//
// POST { pass } → 200 { token } | 400 | 401 | 404 { code: 'no-account' }

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { verifyHivePass } = require('../board/hivePass');

/** Pages that may ask: anything on Hive's shared domain, and KitchenHub's own address. */
const ALLOWED = /^https:\/\/(([a-z0-9-]+\.)?flyingdoublemranch\.com|mykitchenhub\.netlify\.app|mykitchenhub-db665\.web\.app|mykitchenhub-db665\.firebaseapp\.com)$/;

const cors = (req, res) => {
  const origin = req.get('origin');
  if (origin && ALLOWED.test(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
};

/** The whole exchange, without the HTTP bits, for tests. */
async function exchange(pass, { verify = verifyHivePass, auth = () => admin.auth() } = {}) {
  const claims = verify(pass);
  if (!claims) return { status: 401, body: { error: 'That pass is not valid' } };
  if (!claims.email || !claims.email_verified) return { status: 401, body: { error: 'Hive has not confirmed this email' } };
  let user;
  try {
    user = await auth().getUserByEmail(claims.email.toLowerCase());
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return { status: 404, body: { error: 'No KitchenHub account has that email yet', code: 'no-account' } };
    }
    throw err;
  }
  if (user.disabled) return { status: 403, body: { error: 'This account is turned off' } };
  const token = await auth().createCustomToken(user.uid, { hive: true });
  return { status: 200, body: { token } };
}

exports.exchange = exchange;

exports.hiveExchange = functions.https.onRequest(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'content-type');
    res.set('Access-Control-Max-Age', '86400');
    return res.status(204).send('');
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { status, body } = await exchange(req.body && req.body.pass);
    return res.status(status).json(body);
  } catch (err) {
    console.error('[hiveExchange] failed:', err);
    return res.status(500).json({ error: 'Sign-in with Hive is having trouble' });
  }
});
