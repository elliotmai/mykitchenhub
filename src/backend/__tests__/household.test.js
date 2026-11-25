const mockRpc = jest.fn();
const mockMy = jest.fn();
jest.mock('../supabase', () => ({
  core: { rpc: (...a) => mockRpc(...a) },
  forgetHousehold: jest.fn(),
  myHousehold: (...a) => mockMy(...a),
}));
jest.unmock('../household');
const h = jest.requireActual('../household');

beforeEach(() => {
  mockRpc.mockReset();
  mockMy.mockReset();
});

it('finds my household without making one', async () => {
  mockMy.mockResolvedValueOnce('hh');
  expect(await h.currentHousehold()).toBe('hh');
  expect(mockMy).toHaveBeenCalledWith({ create: false });
  mockMy.mockRejectedValueOnce(Object.assign(new Error('none'), { code: 'permission-denied' }));
  expect(await h.currentHousehold()).toBeNull();
  mockMy.mockRejectedValueOnce(new Error('offline'));
  await expect(h.currentHousehold()).rejects.toThrow('offline');
});

it('makes, joins and shares households through Hive’s functions', async () => {
  mockRpc.mockResolvedValue({ data: 'x', error: null });
  await h.createHousehold(' The Smiths ');
  expect(mockRpc).toHaveBeenLastCalledWith('create_household', { name: 'The Smiths' });
  await h.createHousehold('');
  expect(mockRpc).toHaveBeenLastCalledWith('create_household', { name: 'Kitchen' });
  await h.joinHousehold(' ABCD ');
  expect(mockRpc).toHaveBeenLastCalledWith('join_household', { invite: 'ABCD' });
  await h.householdCode('hh');
  expect(mockRpc).toHaveBeenLastCalledWith('create_invite', { hid: 'hh' });
  await h.newHouseholdCode('hh');
  expect(mockRpc).toHaveBeenLastCalledWith('reset_invite', { hid: 'hh' });
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'bad invite' } });
  await expect(h.joinHousehold('x')).rejects.toThrow('bad invite');
});
