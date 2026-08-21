// functions/src/alexa/verifyRequest.js
// Proving a skill request really came from Amazon.
//
// The skill endpoint is a public HTTPS URL with no shared secret in front of
// it. Anything on the internet can POST to it a JSON body claiming to be a
// linked cook asking to empty their shopping list. What stops that is the
// signature Amazon puts on every request, and this module is the whole of that
// check — Amazon requires all of it, and skipping any step fails
// certification for good reason:
//
//   1. the certificate chain URL is one only Amazon can publish to,
//   2. the leaf certificate is valid today and issued for echo-api.amazon.com,
//   3. the chain links up to a certificate authority this machine trusts,
//   4. the signature over the *raw* body verifies against the leaf's key,
//   5. the request is recent, so a captured one cannot be replayed,
//   6. the skill id is ours, so another developer's skill cannot address us.
//
// Step 4 needs the bytes exactly as they arrived. Firebase gives us those on
// `req.rawBody`; re-serialising `req.body` changes key order and whitespace and
// every signature fails.

const crypto = require('crypto');
const tls = require('tls');
const axios = require('axios');

/** Header names, lowercased — Node lowercases incoming headers. */
const CERT_URL_HEADER = 'signaturecertchainurl';
const SIGNATURE_HEADER = 'signature-256';

/** Amazon serves the chain from this bucket and nowhere else. */
const CERT_HOST = 's3.amazonaws.com';
const CERT_PATH_PREFIX = '/echo.api/';

/** The name every Alexa signing certificate carries. */
const ECHO_SAN = 'echo-api.amazon.com';

/** Amazon's tolerance for clock skew and flight time. */
const MAX_TIMESTAMP_SKEW_MS = 150 * 1000;

const CERT_FETCH_TIMEOUT_MS = 5000;

/**
 * Chains change rarely and are fetched on every request otherwise — Amazon
 * explicitly asks skills to cache them by URL.
 */
const certCache = new Map();

let trustedRoots = null;

/** The machine's CA bundle, parsed once. */
function getTrustedRoots() {
  if (!trustedRoots) {
    trustedRoots = tls.rootCertificates
      .map((pem) => {
        try {
          return new crypto.X509Certificate(pem);
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean);
  }
  return trustedRoots;
}

/**
 * Is this a URL Amazon controls?
 *
 * Without this check the whole scheme collapses: an attacker would sign their
 * own body with their own key and point the header at their own certificate.
 */
function isValidCertUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (err) {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.hostname.toLowerCase() !== CERT_HOST) return false;
  if (url.port && url.port !== '443') return false;

  // Normalise `/echo.api/../elsewhere/cert.pem` before comparing the prefix.
  const path = new URL(url.pathname, 'https://example.com').pathname;
  return path.startsWith(CERT_PATH_PREFIX);
}

/** Split a PEM bundle into its certificates, leaf first. */
function parseCertChain(pem) {
  const blocks = String(pem).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!blocks || blocks.length === 0) throw new Error('Certificate chain is empty.');
  return blocks.map((block) => new crypto.X509Certificate(block));
}

async function fetchCertChain(url, { http = axios } = {}) {
  if (certCache.has(url)) return certCache.get(url);

  const response = await http.get(url, {
    timeout: CERT_FETCH_TIMEOUT_MS,
    responseType: 'text',
    // A chain is a few kilobytes. Anything larger is not one.
    maxContentLength: 128 * 1024,
  });

  const certs = parseCertChain(response.data);
  certCache.set(url, certs);
  return certs;
}

/**
 * Does the leaf certificate belong to Alexa, and does the chain hold?
 */
function validateCertChain(certs, now = Date.now()) {
  const [leaf] = certs;
  if (!leaf) throw new Error('Certificate chain is empty.');

  if (Date.parse(leaf.validFrom) > now || Date.parse(leaf.validTo) < now) {
    throw new Error('Signing certificate is not valid today.');
  }

  const names = String(leaf.subjectAltName || '')
    .split(',')
    .map((entry) => entry.trim().replace(/^DNS:/i, '').toLowerCase());
  if (!names.includes(ECHO_SAN)) {
    throw new Error(`Signing certificate is not for ${ECHO_SAN}.`);
  }

  for (let i = 0; i < certs.length - 1; i += 1) {
    const child = certs[i];
    const parent = certs[i + 1];
    if (!child.checkIssued(parent) || !child.verify(parent.publicKey)) {
      throw new Error('Certificate chain does not link up.');
    }
  }

  // The chain has to end somewhere this machine already trusts, or it proves
  // only that whoever built it could build a chain.
  const top = certs[certs.length - 1];
  const roots = getTrustedRoots();
  const anchored = roots.some((root) => {
    try {
      return (
        root.fingerprint256 === top.fingerprint256 ||
        (top.checkIssued(root) && top.verify(root.publicKey))
      );
    } catch (err) {
      return false;
    }
  });

  if (!anchored) throw new Error('Certificate chain is not anchored in a trusted root.');

  return leaf;
}

/**
 * Is this request recent enough to be a live one?
 */
function isTimestampFresh(timestamp, now = Date.now()) {
  const sent = Date.parse(timestamp);
  if (Number.isNaN(sent)) return false;
  return Math.abs(now - sent) <= MAX_TIMESTAMP_SKEW_MS;
}

/**
 * Is this request addressed to our skill?
 *
 * With no configured id this returns true — a skill that has not been created
 * yet has no id to check against, and local development would otherwise be
 * impossible. Deployments set ALEXA_SKILL_ID; see docs/ALEXA_SKILL.md.
 */
function isForThisSkill(body, env = process.env) {
  const expected = env.ALEXA_SKILL_ID;
  if (!expected) return true;

  const actual =
    body?.context?.System?.application?.applicationId ||
    body?.session?.application?.applicationId ||
    null;

  return actual === expected;
}

/**
 * Verify everything about an incoming skill request.
 *
 * @param {object}        options
 * @param {Buffer|string} options.rawBody - the bytes as they arrived
 * @param {object}        options.headers
 * @param {object}        [options.body]  - the parsed body, for timestamp/skill id
 * @param {number}        [options.now]
 * @param {object}        [options.http]  - axios-alike, injected by the tests
 * @param {object}        [options.env]
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function verifyRequest({ rawBody, headers = {}, body, now = Date.now(), http, env } = {}) {
  const certUrl = headers[CERT_URL_HEADER] || headers[CERT_URL_HEADER.toLowerCase()];
  const signature = headers[SIGNATURE_HEADER] || headers[SIGNATURE_HEADER.toLowerCase()];

  if (!rawBody || !rawBody.length) return { valid: false, reason: 'Empty request body.' };
  if (!certUrl) return { valid: false, reason: 'Missing certificate chain URL.' };
  if (!signature) return { valid: false, reason: 'Missing signature.' };
  if (!isValidCertUrl(certUrl)) return { valid: false, reason: 'Certificate chain URL is not Amazon.' };

  const parsed = body || safeParse(rawBody);
  if (!parsed) return { valid: false, reason: 'Request body is not JSON.' };

  if (!isForThisSkill(parsed, env)) return { valid: false, reason: 'Request is for another skill.' };
  if (!isTimestampFresh(parsed?.request?.timestamp, now)) {
    return { valid: false, reason: 'Request timestamp is outside the allowed window.' };
  }

  let leaf;
  try {
    leaf = validateCertChain(await fetchCertChain(String(certUrl), { http }), now);
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  if (!verifySignature({ rawBody, signature, publicKey: leaf.publicKey })) {
    return { valid: false, reason: 'Signature does not match the request body.' };
  }

  return { valid: true };
}

/**
 * Does this signature cover exactly these bytes?
 *
 * Split out from verifyRequest because it is the one step that can be tested
 * against real keys: a certificate chain cannot be conjured up in a unit test,
 * but an RSA keypair can, and this is where a mistake would be silent.
 */
function verifySignature({ rawBody, signature, publicKey }) {
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)));
    return verifier.verify(publicKey, Buffer.from(String(signature), 'base64'));
  } catch (err) {
    return false;
  }
}

function safeParse(rawBody) {
  try {
    return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch (err) {
    return null;
  }
}

module.exports = {
  CERT_URL_HEADER,
  SIGNATURE_HEADER,
  ECHO_SAN,
  MAX_TIMESTAMP_SKEW_MS,
  isValidCertUrl,
  parseCertChain,
  fetchCertChain,
  validateCertChain,
  isTimestampFresh,
  isForThisSkill,
  verifySignature,
  verifyRequest,
  // Tests need a clean cache between cases.
  __clearCertCache: () => certCache.clear(),
};
