const mockAuth = {
  signInWithPassword: jest.fn(),
  verifyOtp: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(async () => ({ error: null })),
  resetPasswordForEmail: jest.fn(async () => ({ error: null })),
  updateUser: jest.fn(async () => ({ data: {}, error: null })),
  getSession: jest.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
  onAuthStateChange: jest.fn(),
};

jest.mock('../supabase', () => ({
  supabase: { auth: mockAuth },
  HIVE_ORIGIN: 'https://hive.test',
  forgetHousehold: jest.fn(),
}));
jest.unmock('../auth');

const auth = jest.requireActual('../auth');

const sbUser = {
  id: 'u-1',
  email: 'cook@example.com',
  email_confirmed_at: '2026-01-01',
  user_metadata: { full_name: 'Cook' },
};
const bad = {
  data: {},
  error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

it('shapes a Supabase user like the Firebase user the screens read', async () => {
  const u = auth.toUser(sbUser);
  expect(u).toMatchObject({
    uid: 'u-1',
    email: 'cook@example.com',
    emailVerified: true,
    displayName: 'Cook',
  });
  expect(await u.getIdToken()).toBe('tok');
  expect(auth.toUser(null)).toBeNull();
});

it('signs in with the password Supabase knows', async () => {
  mockAuth.signInWithPassword.mockResolvedValueOnce({ data: { user: sbUser }, error: null });
  const { user } = await auth.signInWithEmailAndPassword(
    auth.getAuth(),
    ' cook@example.com ',
    'pw'
  );
  expect(user.uid).toBe('u-1');
  expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({
    email: 'cook@example.com',
    password: 'pw',
  });
  expect(global.fetch).not.toHaveBeenCalled();
});

it('carries an old KitchenHub password over through Hive, then signs in', async () => {
  mockAuth.signInWithPassword
    .mockResolvedValueOnce(bad)
    .mockResolvedValueOnce({ data: { user: sbUser }, error: null });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ how: 'password' }) });

  const { user } = await auth.signInWithEmailAndPassword(auth.getAuth(), 'cook@example.com', 'old');
  expect(user.uid).toBe('u-1');
  expect(global.fetch.mock.calls[0][0]).toBe('https://hive.test/api/auth/carry-over');
});

it('finishes a carry-over that answers with a one-time token', async () => {
  mockAuth.signInWithPassword.mockResolvedValueOnce(bad);
  mockAuth.verifyOtp.mockResolvedValueOnce({ data: { user: sbUser }, error: null });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ how: 'token', token: 'th' }) });

  await auth.signInWithEmailAndPassword(auth.getAuth(), 'cook@example.com', 'old');
  expect(mockAuth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'th', type: 'magiclink' });
});

it('says to check email when the carry-over emailed a link', async () => {
  mockAuth.signInWithPassword.mockResolvedValueOnce(bad);
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ how: 'email' }) });
  await expect(
    auth.signInWithEmailAndPassword(auth.getAuth(), 'a@b.c', 'pw')
  ).rejects.toMatchObject({
    code: 'auth/carry-over-emailed',
  });
});

it('reports a wrong password the way Firebase did', async () => {
  mockAuth.signInWithPassword.mockResolvedValueOnce(bad);
  global.fetch.mockResolvedValue({ ok: false });
  await expect(
    auth.signInWithEmailAndPassword(auth.getAuth(), 'a@b.c', 'pw')
  ).rejects.toMatchObject({
    code: 'auth/invalid-credential',
  });
  await expect(auth.signInWithEmailAndPassword(auth.getAuth(), 'a@b.c', '')).rejects.toMatchObject({
    code: 'auth/missing-password',
  });
});

it('maps other errors, including a dropped connection', () => {
  expect(auth.authError({ code: 'weak_password' }).code).toBe('auth/weak-password');
  expect(auth.authError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }).code).toBe(
    'auth/network-request-failed'
  );
  expect(auth.authError({ code: 'something_new' }).code).toBe('auth/internal-error');
  expect(auth.authError(null)).toBeNull();
});

it('signs up, and explains an email that still needs confirming', async () => {
  mockAuth.signUp.mockResolvedValueOnce({
    data: { user: { ...sbUser, identities: [{}] }, session: {} },
    error: null,
  });
  expect((await auth.createUserWithEmailAndPassword(auth.getAuth(), 'a@b.c', 'pw')).user.uid).toBe(
    'u-1'
  );

  mockAuth.signUp.mockResolvedValueOnce({
    data: { user: { ...sbUser, identities: [{}] }, session: null },
    error: null,
  });
  await expect(
    auth.createUserWithEmailAndPassword(auth.getAuth(), 'a@b.c', 'pw')
  ).rejects.toMatchObject({
    code: 'auth/confirm-email',
  });

  mockAuth.signUp.mockResolvedValueOnce({
    data: { user: { ...sbUser, identities: [] }, session: null },
    error: null,
  });
  await expect(
    auth.createUserWithEmailAndPassword(auth.getAuth(), 'a@b.c', 'pw')
  ).rejects.toMatchObject({
    code: 'auth/email-already-in-use',
  });
});

it('reports sign-in changes once each, as Firebase users', async () => {
  let cb;
  const unsubscribe = jest.fn();
  mockAuth.onAuthStateChange.mockImplementation((fn) => {
    cb = fn;
    return { data: { subscription: { unsubscribe } } };
  });
  const seen = [];
  const stop = auth.onAuthStateChanged(auth.getAuth(), (u) => seen.push(u && u.uid));
  cb('INITIAL_SESSION', { user: sbUser });
  cb('TOKEN_REFRESHED', { user: sbUser });
  cb('SIGNED_OUT', null);
  await new Promise((r) => setTimeout(r, 0));
  expect(seen).toEqual(['u-1', null]);
  stop();
  expect(unsubscribe).toHaveBeenCalled();
});

it('passes the account calls through to Supabase', async () => {
  await auth.signOut();
  await auth.sendPasswordResetEmail(auth.getAuth(), ' a@b.c ');
  expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.c', {
    redirectTo: 'https://hive.test/',
  });
  await auth.updateProfile({}, { displayName: 'New' });
  await auth.updateProfile({}, {});
  await auth.updatePassword({}, 'pw2');
  await auth.updateEmail({}, 'n@b.c');
  expect(mockAuth.updateUser).toHaveBeenCalledTimes(3);

  mockAuth.signInWithPassword.mockResolvedValueOnce({ data: { user: sbUser }, error: null });
  const cred = auth.EmailAuthProvider.credential('cook@example.com', 'pw');
  await expect(
    auth.reauthenticateWithCredential({ email: 'cook@example.com' }, cred)
  ).resolves.toBeTruthy();

  mockAuth.updateUser.mockResolvedValueOnce({ data: {}, error: { code: 'weak_password' } });
  await expect(auth.updatePassword({}, 'x')).rejects.toMatchObject({ code: 'auth/weak-password' });
});
