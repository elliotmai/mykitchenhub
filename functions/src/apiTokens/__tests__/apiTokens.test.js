/**
 * Connected apps: mint, list, revoke — against an in-memory core.api_tokens.
 */

const {
  TOKEN_PREFIX,
  MAX_ACTIVE_TOKENS,
  MAX_LABEL_LENGTH,
  generateToken,
  publicId,
  handlers,
  listTokens,
  createToken,
  revokeToken,
} = require('../apiTokens');
const { hashToken } = require('../../board/auth');

const makeStore = (rows = []) => ({
  rows,
  owned: jest.fn(async (uid) => rows.filter((r) => r.user_id === uid).map((r) => ({ ...r }))),
  insert: jest.fn(async (row) => rows.push({ last_used_at: null, revoked_at: null, ...row })),
  revoke: jest.fn(async (hash, at) => {
    rows.find((r) => r.hash === hash).revoked_at = at;
  }),
});

const NOW = new Date('2026-11-24T12:00:00Z');

describe('tokens', () => {
  it('are khapp_ plus 43 base64url characters, never the same twice', () => {
    const a = generateToken();
    expect(a).toMatch(new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`));
    expect(generateToken()).not.toBe(a);
  });
});

describe('createToken', () => {
  it('stores only the hash and returns the token once', async () => {
    const store = makeStore();
    const out = await createToken({ store, uid: 'u1', label: '  Fridge Board ', now: NOW, newToken: () => 'khapp_secret' });

    expect(out).toEqual({
      id: publicId(hashToken('khapp_secret')),
      label: 'Fridge Board',
      createdAt: NOW.toISOString(),
      token: 'khapp_secret',
    });
    expect(store.rows[0]).toMatchObject({ hash: hashToken('khapp_secret'), user_id: 'u1', label: 'Fridge Board' });
    expect(JSON.stringify(store.rows)).not.toContain('khapp_secret');
  });

  it.each([
    ['no name', ''],
    ['a name that is too long', 'x'.repeat(MAX_LABEL_LENGTH + 1)],
  ])('refuses %s', async (_label, label) => {
    await expect(createToken({ store: makeStore(), uid: 'u1', label })).rejects.toMatchObject({
      status: 'invalid-argument',
    });
  });

  it('caps active tokens, not revoked ones', async () => {
    const rows = Array.from({ length: MAX_ACTIVE_TOKENS }, (_, i) => ({
      hash: `${i}`.padStart(64, 'a'),
      user_id: 'u1',
      created_at: NOW.toISOString(),
      revoked_at: null,
    }));
    await expect(createToken({ store: makeStore(rows), uid: 'u1', label: 'One more' })).rejects.toMatchObject({
      status: 'invalid-argument',
    });
    rows[0].revoked_at = NOW.toISOString();
    await expect(createToken({ store: makeStore(rows), uid: 'u1', label: 'One more' })).resolves.toHaveProperty('token');
  });

  it('needs someone signed in', async () => {
    await expect(createToken({ store: makeStore(), uid: null, label: 'x' })).rejects.toMatchObject({
      status: 'unauthenticated',
    });
  });
});

describe('listTokens', () => {
  it("lists the caller's live tokens, newest first, without hashes", async () => {
    const store = makeStore([
      { hash: 'a'.repeat(64), user_id: 'u1', label: 'Old', created_at: '2026-01-01T00:00:00Z', last_used_at: '2026-02-01T00:00:00Z' },
      { hash: 'b'.repeat(64), user_id: 'u1', label: 'New', created_at: '2026-03-01T00:00:00Z' },
      { hash: 'c'.repeat(64), user_id: 'u1', label: 'Gone', created_at: '2026-04-01T00:00:00Z', revoked_at: '2026-04-02T00:00:00Z' },
      { hash: 'd'.repeat(64), user_id: 'u2', label: 'Theirs', created_at: '2026-05-01T00:00:00Z' },
    ]);
    const tokens = await listTokens({ store, uid: 'u1' });
    expect(tokens).toEqual([
      { id: 'bbbbbbbbbbbb', label: 'New', createdAt: '2026-03-01T00:00:00.000Z', lastUsedAt: null },
      { id: 'aaaaaaaaaaaa', label: 'Old', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-02-01T00:00:00.000Z' },
    ]);
    expect(JSON.stringify(tokens)).not.toContain('a'.repeat(64));
  });
});

describe('revokeToken', () => {
  const rows = () => [
    { hash: 'a'.repeat(64), user_id: 'u1', created_at: NOW.toISOString(), revoked_at: null },
    { hash: 'b'.repeat(64), user_id: 'u2', created_at: NOW.toISOString(), revoked_at: null },
  ];

  it('revokes by public id among the caller’s own tokens, twice harmlessly', async () => {
    const store = makeStore(rows());
    await expect(revokeToken({ store, uid: 'u1', id: 'AAAAAAAAAAAA', now: NOW })).resolves.toEqual({ ok: true });
    expect(store.rows[0].revoked_at).toBe(NOW.toISOString());
    await revokeToken({ store, uid: 'u1', id: 'aaaaaaaaaaaa', now: NOW });
    expect(store.revoke).toHaveBeenCalledTimes(1);
  });

  it("cannot reach someone else's token, or take a full hash", async () => {
    const store = makeStore(rows());
    await expect(revokeToken({ store, uid: 'u1', id: 'bbbbbbbbbbbb' })).rejects.toMatchObject({ status: 'not-found' });
    await expect(revokeToken({ store, uid: 'u1', id: 'a'.repeat(64) })).rejects.toMatchObject({
      status: 'invalid-argument',
    });
    expect(store.rows[1].revoked_at).toBeNull();
  });
});

describe('handlers', () => {
  it('answer the three requests by name', async () => {
    const store = makeStore();
    const made = await handlers.createApiToken({ store, uid: 'u1', data: { label: 'Board' } });
    expect((await handlers.listApiTokens({ store, uid: 'u1' })).tokens).toHaveLength(1);
    await handlers.revokeApiToken({ store, uid: 'u1', data: { id: made.id } });
    expect((await handlers.listApiTokens({ store, uid: 'u1' })).tokens).toHaveLength(0);
  });
});
