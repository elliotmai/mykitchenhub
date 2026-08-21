/**
 * Account linking is the only thing standing between a public HTTPS endpoint
 * and somebody else's kitchen, so these tests are mostly about the ways it must
 * say no: an unknown client, a redirect that is not Amazon's, a code redeemed
 * twice, an expired token, a refresh token used as an access token.
 *
 * Firestore is the in-memory fake, because half of what matters here is what
 * ends up stored — and specifically that it is never the credential itself.
 */

jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }));

const {
  createAuthCode,
  exchangeAuthCode,
  refreshAccessToken,
  resolveAccessToken,
  revokeTokensForUser,
  getLinkingConfig,
  isAllowedRedirect,
  issueTokens,
  sha256,
  CODES_COLLECTION,
  TOKENS_COLLECTION,
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
} = require('../accountLinking');
const { createFirestore } = require('../__fixtures__/fakeFirestore');

const UID = 'user-123';
const NOW = Date.parse('2026-08-21T10:00:00Z');
const REDIRECT = 'https://layla.amazon.com/api/skill/link/M2ABC123';

const CONFIG = {
  clientId: 'mykitchenhub-alexa',
  clientSecret: 'super-secret-value',
  allowedRedirects: [],
  configured: true,
};

const credentials = { clientId: CONFIG.clientId, clientSecret: CONFIG.clientSecret };

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getLinkingConfig', () => {
  it('is unconfigured until both halves of the credential are set', () => {
    expect(getLinkingConfig({}).configured).toBe(false);
    expect(getLinkingConfig({ ALEXA_CLIENT_ID: 'id' }).configured).toBe(false);
    expect(getLinkingConfig({ ALEXA_CLIENT_ID: 'id', ALEXA_CLIENT_SECRET: 's' }).configured).toBe(
      true
    );
  });

  it('reads an explicit redirect allowlist', () => {
    const config = getLinkingConfig({
      ALEXA_CLIENT_ID: 'id',
      ALEXA_CLIENT_SECRET: 's',
      ALEXA_REDIRECT_URIS: 'https://a.example.com/cb, https://b.example.com/cb',
    });

    expect(config.allowedRedirects).toEqual(['https://a.example.com/cb', 'https://b.example.com/cb']);
  });
});

describe('isAllowedRedirect', () => {
  const config = { ...CONFIG };

  it('accepts each of the three hosts Amazon publishes', () => {
    expect(isAllowedRedirect('https://layla.amazon.com/api/skill/link/X', config)).toBe(true);
    expect(isAllowedRedirect('https://pitangui.amazon.com/api/skill/link/X', config)).toBe(true);
    expect(isAllowedRedirect('https://alexa.amazon.co.jp/api/skill/link/X', config)).toBe(true);
  });

  it('refuses anywhere else — an open redirect here hands over the code', () => {
    expect(isAllowedRedirect('https://evil.example.com/api/skill/link/X', config)).toBe(false);
    expect(isAllowedRedirect('https://layla.amazon.com.evil.example.com/x', config)).toBe(false);
    expect(isAllowedRedirect('http://layla.amazon.com/api/skill/link/X', config)).toBe(false);
    expect(isAllowedRedirect('not a url', config)).toBe(false);
    expect(isAllowedRedirect('', config)).toBe(false);
  });

  it('honours an explicit allowlist exactly, when one is set', () => {
    const explicit = { ...CONFIG, allowedRedirects: ['https://test.example.com/cb'] };
    expect(isAllowedRedirect('https://test.example.com/cb', explicit)).toBe(true);
    expect(isAllowedRedirect('https://layla.amazon.com/api/skill/link/X', explicit)).toBe(false);
  });
});

describe('createAuthCode', () => {
  it('stores the hash of the code, never the code', async () => {
    const db = createFirestore();
    const { code } = await createAuthCode({
      uid: UID,
      ...credentials,
      redirectUri: REDIRECT,
      db,
      config: CONFIG,
      now: NOW,
    });

    const stored = [...db.__store.entries()];
    expect(stored).toHaveLength(1);

    const [path, data] = stored[0];
    expect(path).toBe(`${CODES_COLLECTION}/${sha256(code)}`);
    expect(path).not.toContain(code);
    expect(JSON.stringify(data)).not.toContain(code);
    expect(data.uid).toBe(UID);
    expect(data.expiresAt.getTime()).toBe(NOW + AUTH_CODE_TTL_MS);
  });

  it('refuses a client id that is not ours', async () => {
    await expect(
      createAuthCode({
        uid: UID,
        clientId: 'someone-elses-skill',
        redirectUri: REDIRECT,
        db: createFirestore(),
        config: CONFIG,
      })
    ).rejects.toThrow('Unknown Alexa client');
  });

  it('refuses a redirect Amazon does not own', async () => {
    await expect(
      createAuthCode({
        uid: UID,
        ...credentials,
        redirectUri: 'https://evil.example.com/steal',
        db: createFirestore(),
        config: CONFIG,
      })
    ).rejects.toThrow('Unrecognised redirect URI');
  });

  it('refuses to link anyone when the skill has no credentials configured', async () => {
    await expect(
      createAuthCode({
        uid: UID,
        ...credentials,
        redirectUri: REDIRECT,
        db: createFirestore(),
        config: { configured: false },
      })
    ).rejects.toThrow('not configured');
  });

  it('needs a signed-in cook', async () => {
    await expect(
      createAuthCode({ ...credentials, redirectUri: REDIRECT, db: createFirestore(), config: CONFIG })
    ).rejects.toThrow('signed-in user');
  });
});

describe('exchangeAuthCode', () => {
  const mintCode = async (db, overrides = {}) =>
    createAuthCode({
      uid: UID,
      ...credentials,
      redirectUri: REDIRECT,
      db,
      config: CONFIG,
      now: NOW,
      ...overrides,
    });

  it('trades a fresh code for an access and refresh token', async () => {
    const db = createFirestore();
    const { code } = await mintCode(db);

    const tokens = await exchangeAuthCode({
      code,
      ...credentials,
      redirectUri: REDIRECT,
      db,
      config: CONFIG,
      now: NOW,
    });

    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(ACCESS_TOKEN_TTL_MS / 1000);
    expect(tokens.access_token).toEqual(expect.any(String));
    expect(tokens.refresh_token).toEqual(expect.any(String));
    expect(tokens.access_token).not.toBe(tokens.refresh_token);

    await expect(
      resolveAccessToken({ accessToken: tokens.access_token, db, now: NOW })
    ).resolves.toBe(UID);
  });

  it('burns the code, so a captured one cannot be replayed', async () => {
    const db = createFirestore();
    const { code } = await mintCode(db);

    await exchangeAuthCode({ code, ...credentials, redirectUri: REDIRECT, db, config: CONFIG, now: NOW });

    expect(db.__store.has(`${CODES_COLLECTION}/${sha256(code)}`)).toBe(false);
    await expect(
      exchangeAuthCode({ code, ...credentials, redirectUri: REDIRECT, db, config: CONFIG, now: NOW })
    ).rejects.toThrow('invalid_grant');
  });

  it('refuses an expired code, and destroys it on the way past', async () => {
    const db = createFirestore();
    const { code } = await mintCode(db);
    const tooLate = NOW + AUTH_CODE_TTL_MS + 1;

    await expect(
      exchangeAuthCode({ code, ...credentials, redirectUri: REDIRECT, db, config: CONFIG, now: tooLate })
    ).rejects.toThrow('invalid_grant');

    // The delete has to survive the rejection: a transaction that throws is
    // rolled back, which would leave the refused code sitting there.
    expect(db.__store.has(`${CODES_COLLECTION}/${sha256(code)}`)).toBe(false);
  });

  it('refuses a redirect URI that is not the one the code was issued for', async () => {
    const db = createFirestore();
    const { code } = await mintCode(db);

    await expect(
      exchangeAuthCode({
        code,
        ...credentials,
        redirectUri: 'https://pitangui.amazon.com/api/skill/link/OTHER',
        db,
        config: CONFIG,
        now: NOW,
      })
    ).rejects.toThrow('invalid_grant');

    expect(db.__store.has(`${CODES_COLLECTION}/${sha256(code)}`)).toBe(false);
  });

  it('refuses the wrong client secret', async () => {
    const db = createFirestore();
    const { code } = await mintCode(db);

    await expect(
      exchangeAuthCode({
        code,
        clientId: CONFIG.clientId,
        clientSecret: 'wrong-secret-value',
        redirectUri: REDIRECT,
        db,
        config: CONFIG,
        now: NOW,
      })
    ).rejects.toThrow('invalid_client');
  });

  it('refuses a code nobody issued', async () => {
    await expect(
      exchangeAuthCode({
        code: 'made-up',
        ...credentials,
        redirectUri: REDIRECT,
        db: createFirestore(),
        config: CONFIG,
        now: NOW,
      })
    ).rejects.toThrow('invalid_grant');
  });
});

describe('refreshAccessToken', () => {
  it('issues a new access token and leaves the refresh token working', async () => {
    const db = createFirestore();
    const first = await issueTokens({ uid: UID, db, now: NOW });

    const later = NOW + ACCESS_TOKEN_TTL_MS + 1000;
    const refreshed = await refreshAccessToken({
      refreshToken: first.refresh_token,
      ...credentials,
      db,
      config: CONFIG,
      now: later,
    });

    expect(refreshed.access_token).not.toBe(first.access_token);
    // Amazon keeps the refresh token it already has; handing back a second one
    // would only leave an orphan behind.
    expect(refreshed.refresh_token).toBeUndefined();

    await expect(resolveAccessToken({ accessToken: refreshed.access_token, db, now: later })).resolves.toBe(UID);
    await expect(
      refreshAccessToken({ refreshToken: first.refresh_token, ...credentials, db, config: CONFIG, now: later })
    ).resolves.toEqual(expect.objectContaining({ token_type: 'Bearer' }));
  });

  it('will not accept an access token in place of a refresh token', async () => {
    const db = createFirestore();
    const { access_token: accessToken } = await issueTokens({ uid: UID, db, now: NOW });

    await expect(
      refreshAccessToken({ refreshToken: accessToken, ...credentials, db, config: CONFIG, now: NOW })
    ).rejects.toThrow('invalid_grant');
  });

  it('refuses the wrong client credentials', async () => {
    const db = createFirestore();
    const { refresh_token: refreshToken } = await issueTokens({ uid: UID, db, now: NOW });

    await expect(
      refreshAccessToken({
        refreshToken,
        clientId: 'not-us',
        clientSecret: CONFIG.clientSecret,
        db,
        config: CONFIG,
        now: NOW,
      })
    ).rejects.toThrow('invalid_client');
  });
});

describe('resolveAccessToken', () => {
  it('turns a live access token into the uid it was issued for', async () => {
    const db = createFirestore();
    const { access_token: accessToken } = await issueTokens({ uid: UID, db, now: NOW });

    await expect(resolveAccessToken({ accessToken, db, now: NOW })).resolves.toBe(UID);
  });

  it('stops recognising it the moment it expires', async () => {
    const db = createFirestore();
    const { access_token: accessToken } = await issueTokens({ uid: UID, db, now: NOW });

    await expect(
      resolveAccessToken({ accessToken, db, now: NOW + ACCESS_TOKEN_TTL_MS + 1 })
    ).resolves.toBeNull();
  });

  it('rejects a refresh token, an unknown token and no token at all', async () => {
    const db = createFirestore();
    const { refresh_token: refreshToken } = await issueTokens({ uid: UID, db, now: NOW });

    await expect(resolveAccessToken({ accessToken: refreshToken, db, now: NOW })).resolves.toBeNull();
    await expect(resolveAccessToken({ accessToken: 'guessed', db, now: NOW })).resolves.toBeNull();
    await expect(resolveAccessToken({ accessToken: null, db, now: NOW })).resolves.toBeNull();
  });
});

describe('revokeTokensForUser', () => {
  it('drops every token for that cook and nobody else', async () => {
    const db = createFirestore();
    const mine = await issueTokens({ uid: UID, db, now: NOW });
    const theirs = await issueTokens({ uid: 'someone-else', db, now: NOW });

    const revoked = await revokeTokensForUser({ uid: UID, db });

    expect(revoked).toBe(2);
    await expect(resolveAccessToken({ accessToken: mine.access_token, db, now: NOW })).resolves.toBeNull();
    await expect(resolveAccessToken({ accessToken: theirs.access_token, db, now: NOW })).resolves.toBe(
      'someone-else'
    );
  });

  it('is a no-op when nothing was linked', async () => {
    await expect(revokeTokensForUser({ uid: UID, db: createFirestore() })).resolves.toBe(0);
    await expect(revokeTokensForUser({ db: createFirestore() })).resolves.toBe(0);
  });
});
