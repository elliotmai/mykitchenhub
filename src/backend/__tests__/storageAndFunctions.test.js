import { makeFakeSupabase } from '../../test-utils/fakeSupabase';

const mockFake = makeFakeSupabase();

jest.mock('../supabase', () => ({
  get supabase() {
    return mockFake.supabase;
  },
  myHousehold: async () => 'hh-1',
  accessToken: async () => 'tok',
}));
jest.unmock('../storage');
jest.unmock('../functions');

const storage = jest.requireActual('../storage');
const functions = jest.requireActual('../functions');

describe('storage', () => {
  it("keeps recipe photos in the household's folder", async () => {
    const r = storage.ref(storage.getStorage(), 'recipes/r1/pic.jpg');
    await storage.uploadBytes(r, { type: 'image/jpeg' }, { contentType: 'image/jpeg' });
    expect(mockFake.storageCalls[0]).toEqual([
      'upload',
      'kitchen',
      'hh-1/recipes/r1/pic.jpg',
      { contentType: 'image/jpeg', upsert: true },
    ]);
    expect(await storage.getDownloadURL(r)).toBe(
      'https://cdn.test/kitchen/hh-1/recipes/r1/pic.jpg'
    );
    await storage.deleteObject(r);
    expect(mockFake.storageCalls[1]).toEqual(['remove', 'kitchen', ['hh-1/recipes/r1/pic.jpg']]);
  });
});

describe('callables', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("call this site's functions with the person's token", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ result: { plan: 1 } }) });
    const out = await functions.httpsCallable(
      functions.getFunctions(),
      'generateMealPlan'
    )({ days: 7 });
    expect(out).toEqual({ data: { plan: 1 } });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/generateMealPlan');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ data: { days: 7 } });
  });

  it('report failures with functions/ codes', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { status: 'unauthenticated', message: 'Sign in.' } }),
    });
    await expect(functions.httpsCallable({}, 'x')()).rejects.toMatchObject({
      code: 'functions/unauthenticated',
      message: 'Sign in.',
    });
    global.fetch.mockRejectedValue(new Error('offline'));
    await expect(functions.httpsCallable({}, 'x')()).rejects.toMatchObject({
      code: 'functions/unavailable',
    });
  });
});
