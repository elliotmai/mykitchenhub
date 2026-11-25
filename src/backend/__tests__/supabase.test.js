const mockRpc = jest.fn();
const mockSession = { current: { user: { id: 'u-1' }, access_token: 'tok' } };

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: jest.fn((url, key, options) => ({
    url,
    options,
    auth: { getSession: async () => ({ data: { session: mockSession.current } }) },
    schema: (name) => ({ name, rpc: (fn, args) => mockRpc(name, fn, args) }),
  })),
}));
jest.unmock('../supabase');

const sb = jest.requireActual('../supabase');

beforeEach(() => {
  mockRpc.mockReset();
  sb.forgetHousehold();
  mockSession.current = { user: { id: 'u-1' }, access_token: 'tok' };
});

it("shares Hive's sign-in cookie", () => {
  expect(sb.supabase.options.cookieOptions.name).toBe('hive-auth');
  expect(sb.supabase.url).toBe(sb.SUPABASE_URL);
});

it('finds my household once and remembers it', async () => {
  mockRpc.mockResolvedValue({ data: 'hh-1', error: null });
  expect(await sb.myHousehold()).toBe('hh-1');
  expect(await sb.myHousehold()).toBe('hh-1');
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(await sb.accessToken()).toBe('tok');
});

it('makes a household for a new cook who has none', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: 'hh-new', error: null });
  expect(await sb.myHousehold({ create: true })).toBe('hh-new');
  expect(mockRpc).toHaveBeenLastCalledWith('core', 'create_household', { name: 'Kitchen' });
});

it('refuses when nobody is signed in, or the lookup fails', async () => {
  mockSession.current = null;
  await expect(sb.myHousehold()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(await sb.accessToken()).toBeNull();

  mockSession.current = { user: { id: 'u-1' } };
  mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST', message: 'down' } });
  await expect(sb.myHousehold()).rejects.toThrow('down');

  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(sb.myHousehold({ create: false })).rejects.toMatchObject({
    code: 'permission-denied',
  });

  mockRpc
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'no' } });
  await expect(sb.myHousehold({ create: true })).rejects.toThrow('no');

  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(sb.myHousehold()).rejects.toMatchObject({ code: 'permission-denied' });
});
