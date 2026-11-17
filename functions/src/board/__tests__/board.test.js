/**
 * The `board` HTTP API, end to end through `handleBoardRequest`.
 *
 * Firestore is an in-memory fake that records every read and write by path,
 * so these tests assert not only what comes back but where the function went
 * to get it — the admin SDK bypasses security rules, so "only the token's
 * user" is enforced by this code and proven by these tests.
 */

jest.mock('firebase-admin', () => ({
  firestore: Object.assign(jest.fn(), {
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  }),
}));

const { makeFakeFirestore, SERVER_TIMESTAMP } = require('../__fixtures__/fakeFirestore');
const {
  NOW,
  TODAY,
  TOKEN,
  OTHER_TOKEN,
  UID,
  OTHER_UID,
  kitchenDocs,
} = require('../__fixtures__/kitchen');
const { handleBoardRequest, routeOf, parseBody, board } = require('../board');

const auth = (token = TOKEN) => ({ authorization: `Bearer ${token}` });

const call = (
  db,
  { method = 'GET', path = '/', headers = auth(), body, rawBody, now = NOW } = {}
) => handleBoardRequest({ db, method, path, headers, body, rawBody, now });

let db;
beforeEach(() => {
  db = makeFakeFirestore(kitchenDocs());
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const touchedOtherUser = () =>
  [...db.__reads, ...db.__writes.map((w) => w.path)].some((path) =>
    path.startsWith(`users/${OTHER_UID}/`)
  );

describe('authentication', () => {
  it.each([
    ['no header', {}],
    ['a non-bearer scheme', { authorization: `Basic ${TOKEN}` }],
    ['a token shorter than 32 characters', { authorization: 'Bearer short-token' }],
    ['an unknown token', { authorization: `Bearer ${'x'.repeat(43)}` }],
  ])('refuses %s with 401', async (_name, headers) => {
    const result = await call(db, { headers });
    expect(result).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(db.__writes).toHaveLength(0);
  });

  it('refuses before routing, so an unknown path does not reveal itself', async () => {
    const result = await call(db, { path: '/nope', headers: {} });
    expect(result.status).toBe(401);
  });

  it('serves the user whose apiTokenHash string field matches', async () => {
    const result = await call(db, { headers: auth(OTHER_TOKEN) });
    expect(result.status).toBe(200);
    expect(db.__reads).toContain(`users/${OTHER_UID}/shoppingItems`);
    expect(db.__reads).not.toContain(`users/${UID}/shoppingItems`);
  });
});

describe('routing', () => {
  it.each([
    ['GET', '/', { name: 'board' }],
    ['GET', '', { name: 'board' }],
    ['POST', '/shopping', { name: 'add' }],
    ['POST', '/shopping/', { name: 'add' }],
    ['POST', '/shopping/item%3Aabc', { name: 'tick', id: 'item:abc' }],
    ['POST', '/shopping/meal:ground%20beef%7Coz', { name: 'tick', id: 'meal:ground beef|oz' }],
    ['GET', '/shopping', null],
    ['POST', '/', null],
    ['DELETE', '/shopping/item:abc', null],
    ['POST', '/shopping/a/b', null],
    ['POST', '/shopping/%E0%A4%A', null],
  ])('%s %s', (method, path, expected) => {
    expect(routeOf(method, path)).toEqual(expected);
  });

  it('answers an unknown route with a JSON 404', async () => {
    expect(await call(db, { method: 'PUT', path: '/' })).toEqual({
      status: 404,
      body: { error: 'Not found.' },
    });
  });

  it('reads a body that arrived as a string or a buffer', () => {
    expect(parseBody('{"name":"Milk"}')).toEqual({ name: 'Milk' });
    expect(parseBody(undefined, Buffer.from('{"bought":true}'))).toEqual({ bought: true });
    expect(parseBody('')).toEqual({});
    expect(() => parseBody('not json')).toThrow('Body must be a JSON object.');
    expect(() => parseBody('[1]')).toThrow('Body must be a JSON object.');
  });

  it('is exported as an HTTPS function', () => {
    expect(typeof board).toBe('function');
  });
});

describe('GET /', () => {
  it('returns the board for the cook in the token, in their timezone', async () => {
    const { status, body } = await call(db);

    expect(status).toBe(200);
    // 03:00 UTC on the 18th is still the 17th in Chicago, the default zone.
    expect(body.today).toBe(TODAY);
    expect(body.meals.map((m) => `${m.date} ${m.type} ${m.name}`)).toEqual([
      '2026-11-17 Breakfast Oats',
      '2026-11-17 Lunch Salad',
      '2026-11-17 Dinner Chili',
      '2026-11-22 Dinner Beef Tacos',
      '2026-11-23 Dinner Salmon',
    ]);
    expect(Object.keys(body.recipes).sort()).toEqual(['r-chili', 'r-oats', 'r-tacos']);
    expect(body.expiring).toEqual([
      { name: 'Yogurt', days: -2 },
      { name: 'Spinach', days: 0 },
      { name: 'Milk', days: 1 },
    ]);
    expect(body.shopping.map((row) => row.id)).toEqual([
      'meal:lettuce|head',
      'item:s-tortillas',
      'meal:ground beef|lb',
      'meal:ground beef|oz',
      'item:s-batteries',
      'item:s-milk',
    ]);
    expect(touchedOtherUser()).toBe(false);
    expect(db.__writes).toHaveLength(0);
  });

  it('honours a timezone recorded on the user document', async () => {
    db = makeFakeFirestore(kitchenDocs({ profile: { timezone: 'Europe/London' } }));
    const { body } = await call(db);
    expect(body.today).toBe('2026-11-18');
    expect(body.meals[0].date).toBe('2026-11-22');
  });

  it('falls back to America/Chicago when the recorded timezone is not one', async () => {
    db = makeFakeFirestore(kitchenDocs({ profile: { timezone: 'Mars/Olympus' } }));
    expect((await call(db)).body.today).toBe(TODAY);
  });

  it('hides a Firestore failure behind a generic 500', async () => {
    db.getAll = async () => {
      throw new Error('secret internal detail');
    };
    const result = await call(db);
    expect(result).toEqual({ status: 500, body: { error: 'Internal error.' } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('POST /shopping', () => {
  it('adds a typed item exactly as the app does, and returns it in the list shape', async () => {
    const result = await call(db, {
      method: 'POST',
      path: '/shopping',
      body: { name: '  Oat milk  ', section: 'Drinks' },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      item: {
        id: 'item:auto-1',
        name: 'Oat milk',
        qty: '',
        section: 'Dairy & Eggs',
        why: null,
        bought: false,
      },
    });
    expect(db.__writes).toEqual([
      {
        op: 'add',
        path: `users/${UID}/shoppingItems/auto-1`,
        data: {
          name: 'Oat milk',
          normalized: 'oat milk',
          quantity: 1,
          unit: '',
          notes: '',
          status: 'pending',
          source: 'manual',
          boughtAt: null,
          createdAt: SERVER_TIMESTAMP,
        },
      },
    ]);
  });

  it.each([
    ['no name', {}],
    ['a blank name', { name: '   ' }],
    ['a non-string name', { name: 42 }],
    ['an over-long name', { name: 'x'.repeat(201) }],
    ['a non-string section', { name: 'Milk', section: 3 }],
  ])('refuses %s with 400', async (_name, body) => {
    const result = await call(db, { method: 'POST', path: '/shopping', body });
    expect(result.status).toBe(400);
    expect(result.body.error).toEqual(expect.any(String));
    expect(db.__writes).toHaveLength(0);
  });

  it('refuses a body that is not JSON', async () => {
    const result = await call(db, { method: 'POST', path: '/shopping', body: 'name=Milk' });
    expect(result).toEqual({ status: 400, body: { error: 'Body must be a JSON object.' } });
  });
});

describe('POST /shopping/{id}', () => {
  it('ticks a typed item off the way the app checkbox does', async () => {
    const result = await call(db, {
      method: 'POST',
      path: '/shopping/item:s-batteries',
      body: { bought: true },
    });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(db.__writes).toEqual([
      {
        op: 'update',
        path: `users/${UID}/shoppingItems/s-batteries`,
        data: { status: 'bought', boughtAt: SERVER_TIMESTAMP },
      },
    ]);
  });

  it('puts a ticked item back on the list', async () => {
    await call(db, { method: 'POST', path: '/shopping/item:s-milk', body: { bought: false } });
    expect(db.__writes[0].data).toEqual({ status: 'pending', boughtAt: null });
  });

  it("cannot tick another cook's item, even by its real id", async () => {
    const result = await call(db, {
      method: 'POST',
      path: '/shopping/item:their-item',
      body: { bought: true },
    });
    expect(result).toEqual({ status: 404, body: { error: 'No such shopping item.' } });
    expect(db.__docs.get(`users/${OTHER_UID}/shoppingItems/their-item`).status).toBe('pending');
    expect(db.__writes).toHaveLength(0);
  });

  it.each(['item:', 'item:nope', 'meal:caviar', 'meal:onions', 'meal:tortillas', 'whatever'])(
    'answers 404 for the unknown id %s',
    async (id) => {
      const result = await call(db, {
        method: 'POST',
        path: `/shopping/${encodeURIComponent(id)}`,
        body: { bought: true },
      });
      expect(result.status).toBe(404);
      expect(db.__writes).toHaveLength(0);
    }
  );

  it('refuses to tick a line derived from the meal plan, as KitchenHub does, and writes nothing', async () => {
    const result = await call(db, {
      method: 'POST',
      path: `/shopping/${encodeURIComponent('meal:ground beef|oz')}`,
      body: { bought: true },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/does not tick those off/);
    expect(db.__writes).toHaveLength(0);
  });

  it.each([[{}], [{ bought: 'yes' }], [{ bought: 1 }]])(
    'refuses a body of %j with 400',
    async (body) => {
      const result = await call(db, { method: 'POST', path: '/shopping/item:s-batteries', body });
      expect(result).toEqual({ status: 400, body: { error: 'bought must be true or false.' } });
    }
  );
});
