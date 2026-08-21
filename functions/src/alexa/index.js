// functions/src/alexa/index.js
// The three HTTPS entry points the Alexa skill needs.
//
//   alexaSkill           the skill endpoint Amazon POSTs every utterance to
//   alexaToken           the OAuth token endpoint account linking exchanges at
//   createAlexaAuthCode  callable, used by the app's /link/alexa page
//   unlinkAlexa          callable, "stop this skill reaching my kitchen"
//
// Setup — skill id, client id and secret, the interaction model — is in
// docs/ALEXA_SKILL.md.

const functions = require('firebase-functions');
const { getFirestore } = require('firebase-admin/firestore');

const { verifyRequest } = require('./verifyRequest');
const { handleSkillRequest } = require('./handleSkillRequest');
const { say } = require('./speech');
const {
  createAuthCode,
  exchangeAuthCode,
  refreshAccessToken,
  revokeTokensForUser,
} = require('./accountLinking');

/**
 * Client credentials arrive either as HTTP Basic auth or in the form body.
 * Amazon uses Basic; the developer console's "test" flow has been known to use
 * the body, and the spec allows both.
 */
function readClientCredentials(req) {
  const header = String(req.get?.('authorization') || req.headers?.authorization || '');

  if (header.toLowerCase().startsWith('basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator > -1) {
      return {
        clientId: decoded.slice(0, separator),
        clientSecret: decoded.slice(separator + 1),
      };
    }
  }

  return {
    clientId: req.body?.client_id,
    clientSecret: req.body?.client_secret,
  };
}

/**
 * The skill endpoint.
 *
 * Always answers 200 with something speakable once the request is verified —
 * a 500 makes Alexa say "there was a problem with the requested skill's
 * response", which tells the cook nothing. Verification failures are the
 * exception: those are not conversations, they are strangers.
 */
const alexaSkill = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // The signature is over the bytes as they arrived. Firebase parses the body
  // for us but keeps the original on `rawBody`, which is the only thing worth
  // verifying — re-serialising the parsed object changes it.
  const verification = await verifyRequest({
    rawBody: req.rawBody,
    headers: req.headers,
    body: req.body,
  });

  if (!verification.valid) {
    console.warn('Rejected Alexa request:', verification.reason);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const response = await handleSkillRequest(req.body, { db: getFirestore() });
    res.status(200).json(response);
  } catch (error) {
    console.error('Alexa skill request failed:', error);
    res.status(200).json(say('Sorry, your kitchen is not answering right now. Try again in a moment.'));
  }
});

/**
 * The OAuth token endpoint.
 *
 * Errors follow RFC 6749: a JSON body with an `error` code and a 400. Amazon
 * shows the cook a generic "unable to link" either way, but the codes are what
 * the developer console's linking test reports back.
 */
const alexaToken = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'invalid_request' });
    return;
  }

  const { clientId, clientSecret } = readClientCredentials(req);
  const grantType = req.body?.grant_type;

  try {
    const db = getFirestore();
    let tokens;

    if (grantType === 'authorization_code') {
      tokens = await exchangeAuthCode({
        code: req.body?.code,
        redirectUri: req.body?.redirect_uri,
        clientId,
        clientSecret,
        db,
      });
    } else if (grantType === 'refresh_token') {
      tokens = await refreshAccessToken({
        refreshToken: req.body?.refresh_token,
        clientId,
        clientSecret,
        db,
      });
    } else {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }

    // These are bearer credentials: no cache, anywhere, ever.
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(200).json(tokens);
  } catch (error) {
    const code = ['invalid_client', 'invalid_grant'].includes(error.message)
      ? error.message
      : 'invalid_request';
    // The message is not logged with the credential it failed on.
    console.warn('Alexa token exchange failed:', code);
    res.status(400).json({ error: code });
  }
});

/**
 * Mint an authorization code for the signed-in cook.
 *
 * Called by the app's /link/alexa page, which is where Amazon sends people to
 * sign in. The page has a Firebase session; Amazon does not — this is the
 * bridge between the two.
 */
const createAlexaAuthCode = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to link Alexa.');
  }

  try {
    const { code } = await createAuthCode({
      uid: context.auth.uid,
      clientId: data?.clientId,
      redirectUri: data?.redirectUri,
      db: getFirestore(),
    });
    return { code };
  } catch (error) {
    console.warn('Alexa auth code refused:', error.message);
    throw new functions.https.HttpsError('failed-precondition', error.message);
  }
});

/** Cut the skill off from this kitchen. */
const unlinkAlexa = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to unlink Alexa.');
  }

  const revoked = await revokeTokensForUser({ uid: context.auth.uid, db: getFirestore() });
  return { revoked };
});

module.exports = {
  alexaSkill,
  alexaToken,
  createAlexaAuthCode,
  unlinkAlexa,
  // Exported for the tests.
  readClientCredentials,
};
