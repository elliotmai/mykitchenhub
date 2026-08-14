// functions/src/recipes/legacyCredentials.js
// Credentials for the legacy "Let's Eat" Firebase project.
//
// These are read from Functions config or the environment — never from the
// service-account JSON files in this directory, which are being rotated out of
// band. Nothing in here logs a credential: the error messages deliberately name
// only the *variable* that was missing.

const admin = require('firebase-admin');

/** Named app so repeated invocations reuse one connection to the legacy project. */
const LEGACY_APP_NAME = 'legacy-lets-eat';

/** Decode a service account supplied as raw JSON or base64-encoded JSON. */
const parseServiceAccount = (raw) => {
  const trimmed = String(raw).trim();
  const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    // Deliberately does not echo the value.
    throw new Error('Legacy service account is not valid JSON.');
  }

  return parsed;
};

/**
 * Resolve legacy credentials, in order of preference:
 *   1. LEGACY_FIREBASE_SERVICE_ACCOUNT       (JSON or base64 JSON)
 *   2. functions.config().legacy.service_account
 *   3. LEGACY_FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY
 *
 * @param {object} deps
 * @param {object} deps.env    - defaults to process.env
 * @param {object} deps.config - Firebase Functions config object
 * @returns {{projectId: string, clientEmail: string, privateKey: string}}
 */
const loadLegacyCredentials = ({ env = process.env, config = {} } = {}) => {
  const inlineJson = env.LEGACY_FIREBASE_SERVICE_ACCOUNT || config?.legacy?.service_account;

  if (inlineJson) {
    const account = parseServiceAccount(inlineJson);
    if (!account.project_id || !account.client_email || !account.private_key) {
      throw new Error(
        'Legacy service account is missing project_id, client_email or private_key.'
      );
    }
    return {
      projectId: account.project_id,
      clientEmail: account.client_email,
      // Config stores newlines escaped; the SDK needs them literal.
      privateKey: String(account.private_key).replace(/\\n/g, '\n'),
    };
  }

  const projectId = env.LEGACY_FIREBASE_PROJECT_ID || config?.legacy?.project_id;
  const clientEmail = env.LEGACY_FIREBASE_CLIENT_EMAIL || config?.legacy?.client_email;
  const privateKey = env.LEGACY_FIREBASE_PRIVATE_KEY || config?.legacy?.private_key;

  const missing = [
    !projectId && 'LEGACY_FIREBASE_PROJECT_ID',
    !clientEmail && 'LEGACY_FIREBASE_CLIENT_EMAIL',
    !privateKey && 'LEGACY_FIREBASE_PRIVATE_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Legacy Firebase credentials are not configured. Set LEGACY_FIREBASE_SERVICE_ACCOUNT, or ${missing.join(', ')}.`
    );
  }

  return { projectId, clientEmail, privateKey: String(privateKey).replace(/\\n/g, '\n') };
};

/**
 * Firestore handle for the legacy project, reusing the named app if it exists.
 *
 * @param {object} deps
 * @param {object} deps.adminSdk - firebase-admin (injectable for tests)
 */
const getLegacyFirestore = ({ adminSdk = admin, env, config } = {}) => {
  const existing = (adminSdk.apps || []).find((app) => app && app.name === LEGACY_APP_NAME);
  if (existing) return existing.firestore();

  const { projectId, clientEmail, privateKey } = loadLegacyCredentials({ env, config });

  const app = adminSdk.initializeApp(
    {
      credential: adminSdk.credential.cert({ projectId, clientEmail, privateKey }),
      projectId,
    },
    LEGACY_APP_NAME
  );

  return app.firestore();
};

module.exports = { LEGACY_APP_NAME, loadLegacyCredentials, getLegacyFirestore };
