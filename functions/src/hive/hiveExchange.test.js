const { exchange } = require('./hiveExchange');

const fakeAuth = (users) => () => ({
  getUserByEmail: async (email) => {
    const u = users[email];
    if (!u) throw Object.assign(new Error('nope'), { code: 'auth/user-not-found' });
    return u;
  },
  createCustomToken: async (uid, claims) => `token-for-${uid}-${claims.hive}`,
});
const good = () => ({ sub: 'hive-1', email: 'Me@Example.com', email_verified: true, name: null });

describe('hiveExchange', () => {
  test('a good pass for an existing account gives a sign-in token', async () => {
    const r = await exchange('p', { verify: good, auth: fakeAuth({ 'me@example.com': { uid: 'kh-1' } }) });
    expect(r).toEqual({ status: 200, body: { token: 'token-for-kh-1-true' } });
  });

  test('a bad pass, or an unconfirmed email, gets nothing', async () => {
    expect((await exchange('p', { verify: () => null, auth: fakeAuth({}) })).status).toBe(401);
    expect((await exchange('p', { verify: () => ({ ...good(), email_verified: false }), auth: fakeAuth({}) })).status).toBe(401);
  });

  test('no account with that email: says so, makes none', async () => {
    const r = await exchange('p', { verify: good, auth: fakeAuth({}) });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('no-account');
  });

  test('a turned-off account is refused', async () => {
    expect((await exchange('p', { verify: good, auth: fakeAuth({ 'me@example.com': { uid: 'kh-1', disabled: true } }) })).status).toBe(403);
  });
});
