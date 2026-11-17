/**
 * Bearer token → exactly one user, or nobody.
 */

const { createHash } = require('node:crypto');

const { makeFakeFirestore } = require('../__fixtures__/fakeFirestore');
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
