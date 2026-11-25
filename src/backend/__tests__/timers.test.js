const mockCalls = [];
const mockChannel = { handlers: [], on: jest.fn(), subscribe: jest.fn() };
mockChannel.on.mockImplementation((_t, filter, fn) => {
  mockChannel.handlers.push({ filter, fn });
  return mockChannel;
});
mockChannel.subscribe.mockImplementation(() => mockChannel);
let mockResult = { data: [], error: null };

const mockBuilder = () => {
  const b = {};
  for (const m of ['select', 'eq', 'order', 'insert', 'delete', 'single']) {
    b[m] = jest.fn((...args) => {
      mockCalls.push([m, ...args]);
      return b;
    });
  }
  b.then = (resolve) => resolve(mockResult);
  return b;
};

jest.mock('../supabase', () => ({
  kitchen: {
    from: (t) => {
      mockCalls.push(['from', t]);
      return mockBuilder();
    },
  },
  supabase: { channel: jest.fn(() => mockChannel), removeChannel: jest.fn() },
  myHousehold: async () => 'hh-1',
}));
jest.unmock('../timers');

const timers = jest.requireActual('../timers');
const { supabase } = require('../supabase');

beforeEach(() => {
  mockCalls.length = 0;
  mockResult = { data: [], error: null };
});

it("lists my household's timers, soonest first", async () => {
  mockResult = { data: [{ id: 'a' }], error: null };
  expect(await timers.listTimers()).toEqual([{ id: 'a' }]);
  expect(mockCalls).toContainEqual(['from', 'timers']);
  expect(mockCalls).toContainEqual(['eq', 'household_id', 'hh-1']);
  expect(mockCalls).toContainEqual(['order', 'ends_at', { ascending: true }]);
});

it('adds one in my household and removes one by id', async () => {
  mockResult = { data: { id: 'b' }, error: null };
  expect(await timers.addTimer({ label: 'x' })).toEqual({ id: 'b' });
  expect(mockCalls).toContainEqual(['insert', { label: 'x', household_id: 'hh-1' }]);
  await timers.removeTimer('b');
  expect(mockCalls).toContainEqual(['eq', 'id', 'b']);
});

it('reports database errors', async () => {
  mockResult = { data: null, error: { message: 'no', code: '42501' } };
  await expect(timers.listTimers()).rejects.toMatchObject({ code: '42501' });
});

it('listens for changes and stops listening', async () => {
  const onChange = jest.fn();
  const stop = timers.watchTimers(onChange);
  await new Promise((r) => setTimeout(r, 0));
  expect(mockChannel.handlers.map((h) => h.filter.event)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
  mockChannel.handlers.forEach((h) => h.fn({}));
  expect(onChange).toHaveBeenCalledTimes(3);
  stop();
  expect(supabase.removeChannel).toHaveBeenCalledWith(mockChannel);
});
