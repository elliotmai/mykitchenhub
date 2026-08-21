/**
 * Request verification — the only thing between a public URL and somebody
 * else's shopping list.
 *
 * A certificate chain cannot be conjured up in a unit test, so the chain checks
 * are driven with stand-in certificates that answer the same questions a real
 * one would, and the signature check — the step where a mistake would be
 * silent — is exercised against a real RSA keypair.
 */

const crypto = require('crypto');

const {
  isValidCertUrl,
  isTimestampFresh,
  isForThisSkill,
  validateCertChain,
  parseCertChain,
  verifySignature,
  verifyRequest,
  MAX_TIMESTAMP_SKEW_MS,
  ECHO_SAN,
  __clearCertCache,
} = require('../verifyRequest');

const NOW = Date.parse('2026-08-21T10:00:00Z');
const SKILL_ID = 'amzn1.ask.skill.abcdef';

const CERT_URL = 'https://s3.amazonaws.com/echo.api/echo-api-cert-7.pem';

/** A certificate that says yes to everything, so tests can say no one thing at a time. */
const fakeCert = (overrides = {}) => ({
  validFrom: 'Aug 1 00:00:00 2026 GMT',
  validTo: 'Aug 1 00:00:00 2027 GMT',
  subjectAltName: `DNS:${ECHO_SAN}, DNS:alexa.amazon.com`,
  fingerprint256: 'AA:BB',
  publicKey: 'public-key',
  checkIssued: () => true,
  verify: () => true,
  ...overrides,
});

beforeEach(() => {
  __clearCertCache();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('isValidCertUrl', () => {
  it('accepts the URL shape Amazon publishes', () => {
    expect(isValidCertUrl(CERT_URL)).toBe(true);
    expect(isValidCertUrl('https://s3.amazonaws.com:443/echo.api/cert.pem')).toBe(true);
    // The host comparison is case-insensitive, as the spec requires.
    expect(isValidCertUrl('https://S3.amazonaws.com/echo.api/cert.pem')).toBe(true);
  });

  it('refuses anything an attacker could publish to', () => {
    expect(isValidCertUrl('http://s3.amazonaws.com/echo.api/cert.pem')).toBe(false);
    expect(isValidCertUrl('https://evil.example.com/echo.api/cert.pem')).toBe(false);
    expect(isValidCertUrl('https://s3.amazonaws.com/echo.api.evil/cert.pem')).toBe(false);
    expect(isValidCertUrl('https://s3.amazonaws.com/anything/cert.pem')).toBe(false);
    expect(isValidCertUrl('https://s3.amazonaws.com:8443/echo.api/cert.pem')).toBe(false);
    expect(isValidCertUrl('not a url')).toBe(false);
    expect(isValidCertUrl(undefined)).toBe(false);
  });

  it('normalises the path before checking the prefix', () => {
    // Otherwise `/echo.api/../evil/cert.pem` walks straight out of the folder
    // that makes the URL trustworthy in the first place.
    expect(isValidCertUrl('https://s3.amazonaws.com/echo.api/../evil/cert.pem')).toBe(false);
  });
});

describe('isTimestampFresh', () => {
  it('accepts a request sent just now', () => {
    expect(isTimestampFresh(new Date(NOW).toISOString(), NOW)).toBe(true);
  });

  it('rejects one old enough to be a replay', () => {
    const stale = new Date(NOW - MAX_TIMESTAMP_SKEW_MS - 1000).toISOString();
    expect(isTimestampFresh(stale, NOW)).toBe(false);
  });

  it('rejects one from the future, and one that is not a date at all', () => {
    expect(isTimestampFresh(new Date(NOW + MAX_TIMESTAMP_SKEW_MS + 1000).toISOString(), NOW)).toBe(false);
    expect(isTimestampFresh('whenever', NOW)).toBe(false);
    expect(isTimestampFresh(undefined, NOW)).toBe(false);
  });
});

describe('isForThisSkill', () => {
  const body = (applicationId) => ({
    context: { System: { application: { applicationId } } },
  });

  it('accepts our skill id', () => {
    expect(isForThisSkill(body(SKILL_ID), { ALEXA_SKILL_ID: SKILL_ID })).toBe(true);
  });

  it('rejects another developer skill pointed at our endpoint', () => {
    expect(isForThisSkill(body('amzn1.ask.skill.someone-else'), { ALEXA_SKILL_ID: SKILL_ID })).toBe(false);
    expect(isForThisSkill({}, { ALEXA_SKILL_ID: SKILL_ID })).toBe(false);
  });

  it('falls back to the session copy of the id', () => {
    const sessionOnly = { session: { application: { applicationId: SKILL_ID } } };
    expect(isForThisSkill(sessionOnly, { ALEXA_SKILL_ID: SKILL_ID })).toBe(true);
  });

  it('skips the check when no skill id is configured — a skill that does not exist yet has no id', () => {
    expect(isForThisSkill(body('anything'), {})).toBe(true);
  });
});

describe('validateCertChain', () => {
  it('accepts a chain that links up and is for echo-api.amazon.com', () => {
    const chain = [fakeCert(), fakeCert({ fingerprint256: 'CC:DD' })];
    expect(() => validateCertChain(chain, NOW)).not.toThrow();
  });

  it('refuses a certificate that has expired', () => {
    const expired = fakeCert({ validTo: 'Aug 1 00:00:00 2026 GMT' });
    expect(() => validateCertChain([expired], Date.parse('2026-08-21T10:00:00Z'))).toThrow(
      'not valid today'
    );
  });

  it('refuses a certificate that is not yet valid', () => {
    const early = fakeCert({ validFrom: 'Aug 1 00:00:00 2027 GMT' });
    expect(() => validateCertChain([early], NOW)).toThrow('not valid today');
  });

  it('refuses a valid certificate issued for something else', () => {
    const wrongName = fakeCert({ subjectAltName: 'DNS:api.example.com' });
    expect(() => validateCertChain([wrongName], NOW)).toThrow(ECHO_SAN);
  });

  it('refuses a chain whose links do not verify', () => {
    const chain = [fakeCert({ verify: () => false }), fakeCert()];
    expect(() => validateCertChain(chain, NOW)).toThrow('does not link up');
  });

  it('refuses a chain that ends nowhere this machine trusts', () => {
    const unanchored = fakeCert({ checkIssued: () => false, verify: () => false });
    expect(() => validateCertChain([unanchored], NOW)).toThrow('trusted root');
  });

  it('refuses an empty chain', () => {
    expect(() => validateCertChain([], NOW)).toThrow('empty');
  });
});

describe('parseCertChain', () => {
  it('refuses a body with no certificate in it', () => {
    expect(() => parseCertChain('not a certificate')).toThrow('empty');
  });
});

describe('verifySignature', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const body = JSON.stringify({ request: { type: 'IntentRequest' } });

  const sign = (payload) =>
    crypto.createSign('RSA-SHA256').update(payload).sign(privateKey).toString('base64');

  it('accepts a signature over exactly these bytes', () => {
    expect(verifySignature({ rawBody: body, signature: sign(body), publicKey })).toBe(true);
    expect(verifySignature({ rawBody: Buffer.from(body), signature: sign(body), publicKey })).toBe(true);
  });

  it('rejects a signature over a different body', () => {
    // This is the whole point: an attacker replaying a captured signature with
    // "remove everything" in the body must not get through.
    const tampered = JSON.stringify({ request: { type: 'SessionEndedRequest' } });
    expect(verifySignature({ rawBody: tampered, signature: sign(body), publicKey })).toBe(false);
  });

  it('rejects rubbish rather than throwing', () => {
    expect(verifySignature({ rawBody: body, signature: 'not-base64-signature', publicKey })).toBe(false);
    expect(verifySignature({ rawBody: body, signature: sign(body), publicKey: 'not a key' })).toBe(false);
  });
});

describe('verifyRequest', () => {
  const freshBody = { request: { type: 'LaunchRequest', timestamp: new Date(NOW).toISOString() } };
  const headers = {
    signaturecertchainurl: CERT_URL,
    'signature-256': 'ZmFrZQ==',
  };

  const call = (overrides = {}) =>
    verifyRequest({
      rawBody: Buffer.from(JSON.stringify(freshBody)),
      headers,
      now: NOW,
      env: {},
      http: { get: jest.fn() },
      ...overrides,
    });

  it('refuses a request with no body, no signature or no certificate URL', async () => {
    await expect(call({ rawBody: Buffer.alloc(0) })).resolves.toMatchObject({ valid: false });
    await expect(call({ headers: { ...headers, 'signature-256': undefined } })).resolves.toMatchObject({
      reason: 'Missing signature.',
    });
    await expect(
      call({ headers: { ...headers, signaturecertchainurl: undefined } })
    ).resolves.toMatchObject({ reason: 'Missing certificate chain URL.' });
  });

  it('refuses a certificate URL that is not Amazon, without fetching it', async () => {
    const http = { get: jest.fn() };
    const result = await call({
      headers: { ...headers, signaturecertchainurl: 'https://evil.example.com/echo.api/c.pem' },
      http,
    });

    expect(result).toMatchObject({ valid: false, reason: 'Certificate chain URL is not Amazon.' });
    expect(http.get).not.toHaveBeenCalled();
  });

  it('refuses a stale request before spending a network call on the chain', async () => {
    const http = { get: jest.fn() };
    const stale = { request: { type: 'LaunchRequest', timestamp: new Date(NOW - 600000).toISOString() } };

    const result = await call({ rawBody: Buffer.from(JSON.stringify(stale)), http });

    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('timestamp') });
    expect(http.get).not.toHaveBeenCalled();
  });

  it('refuses a request addressed to another skill', async () => {
    const other = {
      request: freshBody.request,
      context: { System: { application: { applicationId: 'amzn1.ask.skill.other' } } },
    };

    await expect(
      call({ rawBody: Buffer.from(JSON.stringify(other)), env: { ALEXA_SKILL_ID: SKILL_ID } })
    ).resolves.toMatchObject({ valid: false, reason: 'Request is for another skill.' });
  });

  it('refuses a body that is not JSON at all', async () => {
    await expect(call({ rawBody: Buffer.from('<html>'), body: undefined })).resolves.toMatchObject({
      valid: false,
      reason: 'Request body is not JSON.',
    });
  });

  it('reports a chain it cannot fetch rather than throwing', async () => {
    const http = { get: jest.fn(async () => ({ data: 'nothing useful' })) };
    await expect(call({ http })).resolves.toMatchObject({ valid: false });
  });
});
