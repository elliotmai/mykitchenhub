/**
 * Connected apps: mint, list and revoke `apiTokens/{hash}` for the signed-in
 * cook. Firestore is the board API's in-memory fake, so these tests assert
 * where every write went as well as what came back.
 */

const { createHash } = require('node:crypto');

const mockDb = { current: null };
jest.mock('firebase-admin/firestore', () => {
  const actual = jest.requireActual('firebase-admin/firestore');
  return { ...actual, getFirestore: () => mockDb.current };
});

const { Timestamp } = require('firebase-admin/firestore');
const { makeFakeFirestore } = require('../../board/__fixtures__/fakeFirestore');
const { resolveUser } = require('../../board/auth');
const {
  TOKEN_PREFIX,
  MAX_ACTIVE_TOKENS,
  generateToken,
  publicId,
  cleanLabel,
  listTokens,
  createToken,
  revokeToken,
  listApiTokens,
  createApiToken,
  revokeApiToken,
} = require('../apiTokens');

const UID = 'cook-1';
const OTHER = 'cook-2';
const NOW = new Date('2026-11-17T15:00:00Z');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const at = (iso) => Timestamp.fromDate(new Date(iso));

const tokenDoc = (extra = {}) => ({
  uid: UID,
  label: 'Fridge Board',
  createdAt: at('2026-11-01T10:00:00Z'),
  lastUsedAt: null,
  revokedAt: null,
  ...extra,
});

let db;
beforeEach(() => {
  db = makeFakeFirestore({ [`users/${UID}`]: { email: 'cook@example.com' } });
  mockDb.current = db;
});

describe('generateToken', () => {
  it('is khapp_ plus 32 random bytes as unpadded base64url', () => {
    const token = generateToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    const body = token.slice(TOKEN_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(body, 'base64url')).toHaveLength(32);
  });

  it('never repeats', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('cleanLabel', () => {
  it('trims', () => expect(cleanLabel('  Fridge Board ')).toBe('Fridge Board'));
  it.each([[''], ['   '], [undefined], [42]])('refuses %j', (label) => {
    expect(() => cleanLabel(label)).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
  });
  it('allows 60 characters and refuses 61', () => {
    expect(cleanLabel('a'.repeat(60))).toHaveLength(60);
    expect(() => cleanLabel('a'.repeat(61))).toThrow(/60 characters/);
  });
});

describe('createToken', () => {
  it('stores only the hash, as the document id, and returns the token once', async () => {
    const result = await createToken({ db, uid: UID, label: ' Fridge Board ', now: NOW });

    const hash = sha(result.token);
    expect(result).toEqual({
      id: hash.slice(0, 12),
      label: 'Fridge Board',
      createdAt: NOW.toISOString(),
      token: expect.stringMatching(/^khapp_/),
    });
    expect(db.__writes).toHaveLength(1);
    expect(db.__writes[0].path).toBe(`apiTokens/${hash}`);
    expect(db.__writes[0].data).toEqual({
      uid: UID,
      label: 'Fridge Board',
      createdAt: Timestamp.fromDate(NOW),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(db.__writes)).not.toContain(result.token);
  });

  it('mints a token the board API accepts', async () => {
    const { token } = await createToken({ db, uid: UID, label: 'Fridge Board', now: NOW });
    await expect(resolveUser(db, `Bearer ${token}`)).resolves.toMatchObject({ uid: UID });
  });

  it(`caps a cook at ${MAX_ACTIVE_TOKENS} active tokens`, async () => {
    const docs = {};
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i += 1) docs[`apiTokens/${sha(`t${i}`)}`] = tokenDoc();
    db = makeFakeFirestore(docs);

    await expect(createToken({ db, uid: UID, label: 'One more' })).rejects.toMatchObject({
      code: 'invalid-argument',
      message: expect.stringMatching(/up to 20 apps/),
    });
    expect(db.__writes).toHaveLength(0);
  });

  it('does not count revoked tokens, or other cooks’ tokens, toward the cap', async () => {
    const docs = {};
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i += 1) {
      docs[`apiTokens/${sha(`r${i}`)}`] = tokenDoc({ revokedAt: at('2026-11-02T00:00:00Z') });
      docs[`apiTokens/${sha(`o${i}`)}`] = tokenDoc({ uid: OTHER });
    }
    db = makeFakeFirestore(docs);

    await expect(createToken({ db, uid: UID, label: 'Fridge Board' })).resolves.toHaveProperty(
      'token'
    );
  });

  it('refuses a blank name without writing', async () => {
    await expect(createToken({ db, uid: UID, label: '  ' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(db.__writes).toHaveLength(0);
  });
});

describe('listTokens', () => {
  it('lists the cook’s active tokens, newest first, without the hash', async () => {
    const older = sha('older');
    const newer = sha('newer');
    db = makeFakeFirestore({
      [`apiTokens/${older}`]: tokenDoc({
        label: 'Old app',
        createdAt: at('2026-10-01T00:00:00Z'),
        lastUsedAt: at('2026-11-17T13:00:00Z'),
      }),
      [`apiTokens/${newer}`]: tokenDoc({ label: 'Fridge Board' }),
      [`apiTokens/${sha('revoked')}`]: tokenDoc({
        label: 'Gone',
        revokedAt: at('2026-11-02T00:00:00Z'),
      }),
      [`apiTokens/${sha('theirs')}`]: tokenDoc({ uid: OTHER, label: 'Not mine' }),
    });

    const tokens = await listTokens({ db, uid: UID });

    expect(tokens).toEqual([
      {
        id: newer.slice(0, 12),
        label: 'Fridge Board',
        createdAt: '2026-11-01T10:00:00.000Z',
        lastUsedAt: null,
      },
      {
        id: older.slice(0, 12),
        label: 'Old app',
        createdAt: '2026-10-01T00:00:00.000Z',
        lastUsedAt: '2026-11-17T13:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(tokens)).not.toContain(older);
    expect(JSON.stringify(tokens)).not.toContain(newer);
  });

  it('is empty for a cook with no tokens', async () => {
    await expect(listTokens({ db, uid: UID })).resolves.toEqual([]);
  });
});

describe('revokeToken', () => {
  const HASH = sha('mine');

  beforeEach(() => {
    db = makeFakeFirestore({
      [`apiTokens/${HASH}`]: tokenDoc(),
      [`apiTokens/${sha('theirs')}`]: tokenDoc({ uid: OTHER }),
    });
  });

  it('sets revokedAt on the matching token', async () => {
    await expect(revokeToken({ db, uid: UID, id: publicId(HASH), now: NOW })).resolves.toEqual({
      ok: true,
    });
    expect(db.__writes).toEqual([
      { op: 'update', path: `apiTokens/${HASH}`, data: { revokedAt: Timestamp.fromDate(NOW) } },
    ]);
  });

  it('stops the token working on the board API straight away', async () => {
    const token = (await createToken({ db, uid: UID, label: 'Fridge Board', now: NOW })).token;
    db.__docs.set(`users/${UID}`, { email: 'cook@example.com' });
    await revokeToken({ db, uid: UID, id: publicId(sha(token)), now: NOW });
    await expect(resolveUser(db, `Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
  });

  it('is a 404 for another cook’s token', async () => {
    await expect(revokeToken({ db, uid: UID, id: publicId(sha('theirs')) })).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(db.__writes).toHaveLength(0);
  });

  it('never accepts a full hash from the client', async () => {
    await expect(revokeToken({ db, uid: UID, id: HASH })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(db.__writes).toHaveLength(0);
  });

  it.each([[undefined], [''], ['not-hex-at-all'], [12]])('refuses id %j', async (id) => {
    await expect(revokeToken({ db, uid: UID, id })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('treats revoking twice as done, without rewriting', async () => {
    await revokeToken({ db, uid: UID, id: publicId(HASH), now: NOW });
    await revokeToken({ db, uid: UID, id: publicId(HASH), now: new Date() });
    expect(db.__writes).toHaveLength(1);
  });
});

describe('the callables', () => {
  const signedIn = { auth: { uid: UID } };

  it.each([
    ['listApiTokens', listApiTokens, {}],
    ['createApiToken', createApiToken, { label: 'Fridge Board' }],
    ['revokeApiToken', revokeApiToken, { id: 'abcdefabcdef' }],
  ])('%s refuses a signed-out caller', async (_name, fn, data) => {
    await expect(fn.run(data, {})).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(db.__writes).toHaveLength(0);
  });

  it('round-trips create → list → revoke as the signed-in cook', async () => {
    const created = await createApiToken.run({ label: 'Fridge Board' }, signedIn);
    expect(created.token).toMatch(/^khapp_/);

    const { tokens } = await listApiTokens.run({}, signedIn);
    expect(tokens).toEqual([
      { id: created.id, label: 'Fridge Board', createdAt: created.createdAt, lastUsedAt: null },
    ]);

    await expect(revokeApiToken.run({ id: created.id }, signedIn)).resolves.toEqual({ ok: true });
    await expect(listApiTokens.run({}, signedIn)).resolves.toEqual({ tokens: [] });
  });

  it('acts only on the uid from the ID token, whatever the request says', async () => {
    await createApiToken.run({ label: 'Fridge Board', uid: OTHER }, signedIn);
    const [write] = db.__writes;
    expect(write.data.uid).toBe(UID);
  });

  it('turns an unexpected failure into a generic internal error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db.__failWith(new Error('firestore exploded at users/secret'));
    await expect(listApiTokens.run({}, signedIn)).rejects.toMatchObject({
      code: 'internal',
      message: 'Something went wrong. Please try again.',
    });
    console.error.mockRestore();
  });
});
