/**
 * Bearer token → exactly one user, or nobody.
 */

const { createHash } = require('node:crypto');

jest.mock('firebase-admin', () => ({
  firestore: Object.assign(jest.fn(), {
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  }),
}));

const { makeFakeFirestore, SERVER_TIMESTAMP } = require('../__fixtures__/fakeFirestore');
const { MIN_TOKEN_LENGTH, HttpError, hashToken, bearerToken, resolveUser } = require('../auth');

const TOKEN = 'A'.repeat(43);
const HASH = createHash('sha256').update(TOKEN).digest('hex');

const user = (extra = {}) => ({ email: 'cook@example.com', ...extra });

const expectUnauthorized = async (promise) => {
  await expect(promise).rejects.toBeInstanceOf(HttpError);
  await expect(promise).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
};

describe('hashToken', () => {
  it('is SHA-256 hex, the same as make-api-token.mjs prints', () => {
    expect(hashToken(TOKEN)).toBe(HASH);
    expect(hashToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('bearerToken', () => {
  it.each([
    [`Bearer ${TOKEN}`, TOKEN],
    [`bearer   ${TOKEN}  `, TOKEN],
    [TOKEN, ''],
    [`Basic ${TOKEN}`, ''],
    [`Bearer ${TOKEN} extra`, ''],
    [undefined, ''],
  ])('%j → %j', (header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });
});

describe('resolveUser', () => {
  it('finds the user whose apiTokenHashes array holds the hash', async () => {
    const db = makeFakeFirestore({
      'users/u1': user({ apiTokenHashes: ['other', HASH], timezone: 'Europe/Paris' }),
      'users/u2': user({ apiTokenHashes: ['nope'] }),
    });
    await expect(resolveUser(db, `Bearer ${TOKEN}`)).resolves.toEqual({
      uid: 'u1',
      profile: expect.objectContaining({ timezone: 'Europe/Paris' }),
    });
  });

  it('finds the user whose apiTokenHash string holds the hash', async () => {
    const db = makeFakeFirestore({ 'users/u1': user({ apiTokenHash: HASH }), 'users/u2': user() });
    await expect(resolveUser(db, `Bearer ${TOKEN}`)).resolves.toMatchObject({ uid: 'u1' });
  });

  it('counts a user carrying the hash in both fields once', async () => {
    const db = makeFakeFirestore({
      'users/u1': user({ apiTokenHash: HASH, apiTokenHashes: [HASH] }),
    });
    await expect(resolveUser(db, `Bearer ${TOKEN}`)).resolves.toMatchObject({ uid: 'u1' });
  });

  it('refuses a hash on two different users rather than guessing', async () => {
    const db = makeFakeFirestore({
      'users/u1': user({ apiTokenHash: HASH }),
      'users/u2': user({ apiTokenHashes: [HASH] }),
    });
    await expectUnauthorized(resolveUser(db, `Bearer ${TOKEN}`));
  });

  it('refuses two users with the same array entry', async () => {
    const db = makeFakeFirestore({
      'users/u1': user({ apiTokenHashes: [HASH] }),
      'users/u2': user({ apiTokenHashes: [HASH] }),
    });
    await expectUnauthorized(resolveUser(db, `Bearer ${TOKEN}`));
  });

  it('refuses a token nobody holds', async () => {
    const db = makeFakeFirestore({ 'users/u1': user({ apiTokenHash: hashToken('B'.repeat(43)) }) });
    await expectUnauthorized(resolveUser(db, `Bearer ${TOKEN}`));
  });

  it('refuses a short token without querying Firestore', async () => {
    const short = 'C'.repeat(MIN_TOKEN_LENGTH - 1);
    const db = makeFakeFirestore({ 'users/u1': user({ apiTokenHash: hashToken(short) }) });
    await expectUnauthorized(resolveUser(db, `Bearer ${short}`));
    expect(db.__reads).toHaveLength(0);
  });

  it('never matches the raw token stored by mistake in place of its hash', async () => {
    const db = makeFakeFirestore({ 'users/u1': user({ apiTokenHash: TOKEN }) });
    await expectUnauthorized(resolveUser(db, `Bearer ${TOKEN}`));
  });
});

describe('resolveUser — tokens minted under Connected apps', () => {
  const APP_TOKEN = `khapp_${'Z'.repeat(43)}`;
  const APP_HASH = createHash('sha256').update(APP_TOKEN).digest('hex');
  const created = { toDate: () => new Date('2026-11-01T12:00:00Z') };

  const appToken = (extra = {}) => ({
    uid: 'u1',
    label: 'Fridge Board',
    createdAt: created,
    lastUsedAt: null,
    revokedAt: null,
    ...extra,
  });

  it('resolves apiTokens/{hash} to its owner, with their profile', async () => {
    const db = makeFakeFirestore({
      [`apiTokens/${APP_HASH}`]: appToken(),
      'users/u1': user({ timezone: 'Europe/Paris' }),
    });
    await expect(resolveUser(db, `Bearer ${APP_TOKEN}`)).resolves.toEqual({
      uid: 'u1',
      profile: expect.objectContaining({ timezone: 'Europe/Paris' }),
    });
  });

  it('looks the token up by its hash with a single get, before any legacy query', async () => {
    const db = makeFakeFirestore({
      [`apiTokens/${APP_HASH}`]: appToken(),
      'users/u1': user(),
    });
    await resolveUser(db, `Bearer ${APP_TOKEN}`);
    expect(db.__reads[0]).toBe(`apiTokens/${APP_HASH}`);
    expect(db.__reads).not.toContain('users');
  });

  it('stamps lastUsedAt on the token document', async () => {
    const db = makeFakeFirestore({
      [`apiTokens/${APP_HASH}`]: appToken(),
      'users/u1': user(),
    });
    await resolveUser(db, `Bearer ${APP_TOKEN}`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(db.__writes).toEqual([
      { op: 'update', path: `apiTokens/${APP_HASH}`, data: { lastUsedAt: SERVER_TIMESTAMP } },
    ]);
  });

  it('still lets the request through when stamping lastUsedAt fails', async () => {
    const db = makeFakeFirestore({
      [`apiTokens/${APP_HASH}`]: appToken(),
      'users/u1': user(),
    });
    const original = db.collection;
    db.collection = (name) => {
      const ref = original(name);
      if (name !== 'apiTokens') return ref;
      return {
        ...ref,
        doc: (id) => ({
          ...ref.doc(id),
          update: () => Promise.reject(new Error('quota')),
        }),
      };
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(resolveUser(db, `Bearer ${APP_TOKEN}`)).resolves.toMatchObject({ uid: 'u1' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/lastUsedAt/), 'Error');
    warn.mockRestore();
  });

  it('refuses a revoked token, even if the same hash is on a user document', async () => {
    const db = makeFakeFirestore({
      [`apiTokens/${APP_HASH}`]: appToken({ revokedAt: created }),
      'users/u1': user({ apiTokenHashes: [APP_HASH] }),
    });
    await expectUnauthorized(resolveUser(db, `Bearer ${APP_TOKEN}`));
    expect(db.__writes).toHaveLength(0);
  });

  it('refuses a token whose owner has no user document', async () => {
    const db = makeFakeFirestore({ [`apiTokens/${APP_HASH}`]: appToken({ uid: 'gone' }) });
    await expectUnauthorized(resolveUser(db, `Bearer ${APP_TOKEN}`));
  });

  it('refuses a token document with no owner', async () => {
    const db = makeFakeFirestore({
      [`apiTokens/${APP_HASH}`]: appToken({ uid: undefined }),
      'users/u1': user(),
    });
    await expectUnauthorized(resolveUser(db, `Bearer ${APP_TOKEN}`));
  });

  it('falls back to the legacy fields when there is no token document', async () => {
    const db = makeFakeFirestore({ 'users/u1': user({ apiTokenHashes: [APP_HASH] }) });
    await expect(resolveUser(db, `Bearer ${APP_TOKEN}`)).resolves.toMatchObject({ uid: 'u1' });
  });

  it('answers every failure with the same 401 body', async () => {
    const db = makeFakeFirestore({ [`apiTokens/${APP_HASH}`]: appToken({ revokedAt: created }) });
    await expect(resolveUser(db, `Bearer ${APP_TOKEN}`)).rejects.toMatchObject({
      status: 401,
      message: 'Unauthorized',
    });
    await expect(resolveUser(db, `Bearer ${'Q'.repeat(43)}`)).rejects.toMatchObject({
      status: 401,
      message: 'Unauthorized',
    });
  });
});
