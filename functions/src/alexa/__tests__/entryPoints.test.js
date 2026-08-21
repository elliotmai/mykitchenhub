/**
 * The HTTPS entry points, with the Firebase wrappers mocked away so the
 * handlers can be called as plain functions.
 *
 * What is worth testing here is the plumbing that would otherwise only be
 * exercised by a live skill: where client credentials are read from, that a
 * failed verification is a 401 rather than a spoken answer, and that a genuine
 * request never gets a 500 — Alexa turns one of those into "there was a problem
 * with the requested skill's response", which tells the cook nothing.
 */

const handlers = {};

jest.mock('firebase-functions', () => ({
  https: {
    onRequest: (handler) => handler,
    onCall: (handler) => handler,
    HttpsError: class HttpsError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
  },
}));

jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
jest.mock('../verifyRequest', () => ({ verifyRequest: jest.fn() }));
jest.mock('../handleSkillRequest', () => ({ handleSkillRequest: jest.fn() }));
jest.mock('../accountLinking', () => ({
  createAuthCode: jest.fn(),
  exchangeAuthCode: jest.fn(),
  refreshAccessToken: jest.fn(),
  revokeTokensForUser: jest.fn(),
}));

const { verifyRequest } = require('../verifyRequest');
const { handleSkillRequest } = require('../handleSkillRequest');
const accountLinking = require('../accountLinking');

const { alexaSkill, alexaToken, createAlexaAuthCode, unlinkAlexa, readClientCredentials } =
  require('../index');

const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    send(payload) {
      res.body = payload;
      return res;
    },
    set(key, value) {
      res.headers[key] = value;
      return res;
    },
  };
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('readClientCredentials', () => {
  it('reads HTTP Basic auth, which is what Amazon sends', () => {
    const encoded = Buffer.from('client-id:client-secret').toString('base64');
    const req = { headers: { authorization: `Basic ${encoded}` }, body: {} };

    expect(readClientCredentials(req)).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
  });

  it('keeps a secret containing a colon intact', () => {
    const encoded = Buffer.from('client-id:secret:with:colons').toString('base64');
    const req = { headers: { authorization: `basic ${encoded}` }, body: {} };

    expect(readClientCredentials(req).clientSecret).toBe('secret:with:colons');
  });

  it('falls back to the form body, which the spec also allows', () => {
    const req = { headers: {}, body: { client_id: 'from-body', client_secret: 'secret' } };

    expect(readClientCredentials(req)).toEqual({ clientId: 'from-body', clientSecret: 'secret' });
  });
});

describe('alexaSkill', () => {
  const req = { method: 'POST', rawBody: Buffer.from('{}'), headers: {}, body: {} };

  it('turns away anything that fails verification, without running the skill', async () => {
    verifyRequest.mockResolvedValue({ valid: false, reason: 'Missing signature.' });
    const res = makeRes();

    await alexaSkill(req, res);

    expect(res.statusCode).toBe(401);
    expect(handleSkillRequest).not.toHaveBeenCalled();
  });

  it('answers a verified request with what the skill said', async () => {
    verifyRequest.mockResolvedValue({ valid: true });
    handleSkillRequest.mockResolvedValue({ version: '1.0', response: { shouldEndSession: true } });
    const res = makeRes();

    await alexaSkill(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ version: '1.0' });
  });

  it('says something speakable when the kitchen breaks, rather than failing', async () => {
    verifyRequest.mockResolvedValue({ valid: true });
    handleSkillRequest.mockRejectedValue(new Error('Firestore is having a day'));
    const res = makeRes();

    await alexaSkill(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.response.outputSpeech.text).toMatch(/not answering right now/);
  });

  it('refuses anything that is not a POST', async () => {
    const res = makeRes();
    await alexaSkill({ ...req, method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('alexaToken', () => {
  const post = (body) => ({ method: 'POST', headers: {}, body });

  it('exchanges an authorization code', async () => {
    accountLinking.exchangeAuthCode.mockResolvedValue({ access_token: 'a', token_type: 'Bearer' });
    const res = makeRes();

    await alexaToken(post({ grant_type: 'authorization_code', code: 'c', client_id: 'i', client_secret: 's' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.access_token).toBe('a');
    // Bearer credentials must not sit in a cache anywhere.
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('refreshes an access token', async () => {
    accountLinking.refreshAccessToken.mockResolvedValue({ access_token: 'b' });
    const res = makeRes();

    await alexaToken(post({ grant_type: 'refresh_token', refresh_token: 'r' }), res);

    expect(accountLinking.refreshAccessToken).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('reports a refused grant in the shape the spec asks for', async () => {
    accountLinking.exchangeAuthCode.mockRejectedValue(new Error('invalid_grant'));
    const res = makeRes();

    await alexaToken(post({ grant_type: 'authorization_code', code: 'used-already' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_grant' });
  });

  it('does not leak an unexpected error message back to the caller', async () => {
    accountLinking.exchangeAuthCode.mockRejectedValue(new Error('Firestore quota exceeded for project x'));
    const res = makeRes();

    await alexaToken(post({ grant_type: 'authorization_code', code: 'c' }), res);

    expect(res.body).toEqual({ error: 'invalid_request' });
  });

  it('refuses a grant type it does not implement', async () => {
    const res = makeRes();
    await alexaToken(post({ grant_type: 'password' }), res);
    expect(res.body).toEqual({ error: 'unsupported_grant_type' });
  });
});

describe('createAlexaAuthCode', () => {
  it('mints a code for the signed-in cook', async () => {
    accountLinking.createAuthCode.mockResolvedValue({ code: 'the-code' });

    const result = await createAlexaAuthCode(
      { clientId: 'i', redirectUri: 'https://layla.amazon.com/api/skill/link/X' },
      { auth: { uid: 'user-123' } }
    );

    expect(result).toEqual({ code: 'the-code' });
    expect(accountLinking.createAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-123' })
    );
  });

  it('refuses when nobody is signed in', async () => {
    await expect(createAlexaAuthCode({}, {})).rejects.toThrow('Sign in to link Alexa');
    expect(accountLinking.createAuthCode).not.toHaveBeenCalled();
  });

  it('passes on why linking was refused', async () => {
    accountLinking.createAuthCode.mockRejectedValue(new Error('Unrecognised redirect URI.'));

    await expect(createAlexaAuthCode({}, { auth: { uid: 'user-123' } })).rejects.toThrow(
      'Unrecognised redirect URI.'
    );
  });
});

describe('unlinkAlexa', () => {
  it('revokes every token the cook has', async () => {
    accountLinking.revokeTokensForUser.mockResolvedValue(2);

    await expect(unlinkAlexa({}, { auth: { uid: 'user-123' } })).resolves.toEqual({ revoked: 2 });
  });

  it('refuses when nobody is signed in', async () => {
    await expect(unlinkAlexa({}, {})).rejects.toThrow('Sign in to unlink Alexa');
  });
});
