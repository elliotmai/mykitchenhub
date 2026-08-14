/**
 * The server-side half of CSV bulk import.
 *
 * firebase-admin is mocked with a recording fake (the same approach as
 * onUserCreate.test.js) so these assert *what* was written to *which* path,
 * including the 500-write batching a big file depends on, without an emulator.
 */

let batches;
let writes;
let collectionGets;
let autoId;

const makeDb = () => {
  const docRef = (path) => ({
    __path: path,
    id: path.split('/').pop(),
    set: jest.fn(async (data) => {
      writes.push({ path, data });
    }),
    collection: (name) => collectionRef(`${path}/${name}`),
  });

  const collectionRef = (path) => ({
    __path: path,
    doc: (id) => docRef(`${path}/${id || `auto-${++autoId}`}`),
    get: jest.fn(async () => collectionGets[path] || { docs: [], empty: true, size: 0 }),
  });

  return {
    collection: (name) => collectionRef(name),
    batch: jest.fn(() => {
      const batch = {
        set: jest.fn(),
        commit: jest.fn(async () => undefined),
      };
      batches.push(batch);
      return batch;
    }),
  };
};

jest.mock('firebase-admin', () => {
  const firestore = jest.fn(() => global.__db);
  firestore.FieldValue = { serverTimestamp: jest.fn(() => 'server-timestamp') };
  firestore.Timestamp = { fromDate: jest.fn((d) => ({ toDate: () => d })) };

  return {
    initializeApp: jest.fn(),
    apps: [],
    firestore,
    auth: jest.fn(() => global.__auth),
    credential: { cert: jest.fn(), applicationDefault: jest.fn() },
  };
});

const admin = require('firebase-admin');
const {
  importCSVForUser,
  handler,
  importInventoryFromCSV,
  buildInventoryDoc,
  resolveShelfLifeDays,
  chunk,
  BATCH_SIZE,
  MAX_LOGGED_ERRORS,
} = require('../importInventoryFromCSV');

const USER = 'user-1';
const LOCATIONS_PATH = `users/${USER}/storageLocations`;
const INVENTORY_PATH = `users/${USER}/inventory`;

const LOCATIONS = [
  { id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' },
  { id: 'loc-freezer', label: 'Garage Freezer', type: 'freezer' },
  { id: 'loc-pantry', label: 'Pantry', type: 'pantry' },
];

const seedLocations = (locations = LOCATIONS) => {
  collectionGets[LOCATIONS_PATH] = {
    empty: locations.length === 0,
    size: locations.length,
    docs: locations.map(({ id, ...data }) => ({ id, data: () => data })),
  };
};

const csv = (...lines) => lines.join('\n');
const HEADER = 'name,quantity,unit,location';

/** Every document handed to a batch, across every commit, in write order. */
const batchedItems = () =>
  batches.flatMap((batch) =>
    batch.set.mock.calls.map(([ref, data]) => ({ path: ref.__path, data }))
  );

const historyRecord = () => writes.find((w) => w.path.includes('/importHistory/'));

const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set: jest.fn((key, value) => {
      res.headers[key] = value;
    }),
    status: jest.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body) => {
      res.body = body;
      return res;
    }),
    send: jest.fn((body) => {
      res.body = body;
      return res;
    }),
  };
  return res;
};

const makeReq = (overrides = {}) =>
  Object.assign({ method: 'POST', body: {}, headers: {} }, overrides);

beforeEach(() => {
  batches = [];
  writes = [];
  collectionGets = {};
  autoId = 0;
  global.__db = makeDb();
  global.__auth = { verifyIdToken: jest.fn(async () => ({ uid: 'token-user' })) };
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('chunk', () => {
  it('splits rows at Firestore’s 500-write batch limit', () => {
    expect(chunk(new Array(1200).fill('x')).map((c) => c.length)).toEqual([500, 500, 200]);
    expect(BATCH_SIZE).toBe(500);
  });
});

describe('resolveShelfLifeDays', () => {
  it('uses the shelf life the file gave', () => {
    expect(resolveShelfLifeDays({ shelfLifeDays: 12, name: 'milk', locationType: 'fridge' })).toBe(
      12
    );
  });

  it('derives days from an explicit expiry date', () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 20);

    expect(resolveShelfLifeDays({ expiresAt, name: 'milk', locationType: 'fridge' })).toBe(20);
  });

  it('falls back to what the ingredient table knows', () => {
    expect(resolveShelfLifeDays({ name: 'chicken breast', locationType: 'freezer' })).toBe(270);
  });

  it('falls back again to the default for that kind of storage', () => {
    expect(resolveShelfLifeDays({ name: 'unheard-of thing', locationType: 'freezer' })).toBe(90);
  });

  it('falls back for an ingredient that does not belong in that location', () => {
    // The table says milk has no pantry shelf life at all. Someone put it there
    // anyway, so give it the pantry default rather than writing null.
    expect(resolveShelfLifeDays({ name: 'milk', locationType: 'pantry' })).toBe(90);
  });

  it('gives an already-expired item at least a day', () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() - 30);

    expect(resolveShelfLifeDays({ expiresAt, name: 'milk', locationType: 'fridge' })).toBe(1);
  });

  it('always resolves to a positive number of days', () => {
    ['fridge', 'freezer', 'pantry'].forEach((locationType) => {
      const days = resolveShelfLifeDays({ name: 'unheard-of thing', locationType });

      expect(typeof days).toBe('number');
      expect(days).toBeGreaterThan(0);
    });
  });
});

describe('buildInventoryDoc', () => {
  const data = {
    name: 'Milk',
    normalized: 'milk',
    quantity: 2,
    unit: 'gal',
    locationId: 'loc-fridge',
    locationType: 'fridge',
    notes: '',
    shelfLifeDays: null,
    expiresAt: null,
    price: null,
    store: '',
  };

  it('tags the item csv-import, the source the security rules accept', () => {
    const doc = buildInventoryDoc(data, 'server-timestamp');

    expect(doc.source).toBe('csv-import');
    expect(doc.addedBy).toBeUndefined();
  });

  it('includes every field the rules require on create', () => {
    const doc = buildInventoryDoc(data, 'server-timestamp');

    ['name', 'normalized', 'quantity', 'unit', 'locationId', 'locationType', 'addedAt', 'source']
      .forEach((field) => expect(doc[field]).toBeDefined());
    expect(doc.quantity).toBeGreaterThan(0);
    expect(doc.addedAt).toBe('server-timestamp');
  });

  it('keeps an expiry date the file supplied', () => {
    const expiresAt = new Date('2027-03-01');

    expect(buildInventoryDoc({ ...data, expiresAt }, 'ts').expiresAt).toBe(expiresAt);
  });
});

// ---------------------------------------------------------------------------
// importCSVForUser
// ---------------------------------------------------------------------------

describe('importCSVForUser', () => {
  const run = (csvData, fileName = 'kitchen.csv') =>
    importCSVForUser({ db: global.__db, userId: USER, csvData, fileName });

  it('writes each valid row into the user’s inventory', async () => {
    seedLocations();

    const result = await run(csv(HEADER, 'Milk,1,gal,Main Fridge', 'Rice,5,lbs,Pantry'));

    expect(result).toMatchObject({ status: 'completed', itemsImported: 2, itemsSkipped: 0 });

    const items = batchedItems();
    expect(items).toHaveLength(2);
    items.forEach(({ path, data }) => {
      expect(path).toMatch(new RegExp(`^${INVENTORY_PATH}/`));
      expect(data.source).toBe('csv-import');
    });
    expect(items.map(({ data }) => data.name)).toEqual(['Milk', 'Rice']);
  });

  it('resolves each row to one of the user’s own locations', async () => {
    seedLocations();

    await run(csv(HEADER, 'Peas,2,bags,freezer'));

    expect(batchedItems()[0].data).toMatchObject({
      locationId: 'loc-freezer',
      locationType: 'freezer',
    });
  });

  it('imports the good rows and reports the bad ones', async () => {
    seedLocations();

    const result = await run(
      csv(HEADER, 'Milk,1,gal,Main Fridge', ',2,lbs,Pantry', 'Jar,1,ea,Wine Cellar')
    );

    expect(result).toMatchObject({ status: 'completed', itemsImported: 1, itemsSkipped: 2 });
    expect(result.errors).toEqual([
      { row: 3, message: 'Missing item name.' },
      { row: 4, message: 'No storage location called "Wine Cellar".' },
    ]);
    expect(batchedItems()).toHaveLength(1);
  });

  it('commits a 1,200-row file 500 at a time', async () => {
    seedLocations();
    const rows = Array.from({ length: 1200 }, (_, i) => `Item ${i},1,ea,Pantry`);

    const result = await run(csv(HEADER, ...rows));

    expect(result.itemsImported).toBe(1200);
    expect(batches).toHaveLength(3);
    expect(batches.map((b) => b.set.mock.calls.length)).toEqual([500, 500, 200]);
    batches.forEach((batch) => expect(batch.commit).toHaveBeenCalledTimes(1));
  });

  it('handles a 150-item file in a single batch', async () => {
    seedLocations();
    const rows = Array.from({ length: 150 }, (_, i) => `Item ${i},2,ea,Main Fridge`);

    const result = await run(csv(HEADER, ...rows));

    expect(result.itemsImported).toBe(150);
    expect(batches).toHaveLength(1);
  });

  it.each([
    [499, [499]],
    [500, [500]],
    [501, [500, 1]],
    [1000, [500, 500]],
  ])('commits %s rows as %j', async (count, expected) => {
    seedLocations();
    const rows = Array.from({ length: count }, (_, i) => `Item ${i},1,ea,Pantry`);

    const result = await run(csv(HEADER, ...rows));

    expect(result.itemsImported).toBe(count);
    expect(batches.map((b) => b.set.mock.calls.length)).toEqual(expected);
  });

  it('reports a file whose every row is broken as a completed run that added nothing', async () => {
    // Surprising but deliberate: the run itself finished, and the history
    // record is what tells the person their file needs work. It is `failed`
    // only when Firestore refused a write.
    seedLocations();

    const result = await run(csv(HEADER, ',1,ea,Pantry', 'Jar,1,ea,Wine Cellar'));

    expect(result).toMatchObject({ status: 'completed', itemsImported: 0, itemsSkipped: 2 });
    expect(batches).toHaveLength(0);
    expect(historyRecord().data).toMatchObject({ status: 'completed', itemsImported: 0 });
  });

  it('imports the same file twice without noticing', async () => {
    // There is no de-duplication: importing January's shop twice gives two of
    // everything, and two history records saying so. The history list in the
    // importer is what makes a repeat obvious.
    seedLocations();
    const file = csv(HEADER, 'Milk,1,gal,Main Fridge');

    await run(file, 'january.csv');
    await run(file, 'january.csv');

    expect(batchedItems()).toHaveLength(2);
    expect(writes.filter((w) => w.path.includes('/importHistory/'))).toHaveLength(2);
  });

  it('numbers a bad row after a blank line by the line the person sees', async () => {
    seedLocations();

    const result = await run(csv(HEADER, 'Milk,1,gal,Main Fridge', '', ',1,gal,Pantry'));

    expect(result.errors).toEqual([{ row: 4, message: 'Missing item name.' }]);
  });

  it('logs the run in the import history', async () => {
    seedLocations();

    const result = await run(csv(HEADER, 'Milk,1,gal,Main Fridge', ',1,gal,Pantry'), 'january.csv');

    const record = historyRecord();
    expect(record.path).toMatch(new RegExp(`^users/${USER}/importHistory/`));
    expect(record.data).toMatchObject({
      fileName: 'january.csv',
      itemsImported: 1,
      itemsSkipped: 1,
      status: 'completed',
      source: 'csv-import',
      importedAt: 'server-timestamp',
    });
    expect(result.importId).toBe(record.path.split('/').pop());
  });

  it('caps how many row problems it stores', async () => {
    seedLocations();
    const rows = Array.from({ length: MAX_LOGGED_ERRORS + 5 }, (_, i) => `Bad ${i},,ea,Pantry`);

    const result = await run(csv(HEADER, ...rows));

    expect(result.errors).toHaveLength(MAX_LOGGED_ERRORS);
    expect(historyRecord().data.errorCount).toBe(MAX_LOGGED_ERRORS + 5);
  });

  it('rejects a file with the wrong columns without writing anything', async () => {
    seedLocations();

    const result = await run('fruit,howmany\napples,3');

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/needs a name, quantity, location column/);
    expect(batches).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('rejects an account with no storage locations', async () => {
    seedLocations([]);

    const result = await run(csv(HEADER, 'Milk,1,gal,Main Fridge'));

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/no storage locations/);
  });

  it('reports what it saved when a later batch fails', async () => {
    seedLocations();
    const rows = Array.from({ length: 600 }, (_, i) => `Item ${i},1,ea,Pantry`);

    const db = global.__db;
    let batchCount = 0;
    const realBatch = db.batch;
    db.batch = jest.fn(() => {
      const batch = realBatch();
      if (++batchCount === 2) {
        batch.commit = jest.fn(async () => {
          throw new Error('deadline exceeded');
        });
      }
      return batch;
    });

    const result = await run(csv(HEADER, ...rows));

    expect(result).toMatchObject({ status: 'partial', itemsImported: 500, itemsSkipped: 100 });
    expect(historyRecord().data.status).toBe('partial');
    expect(result.errors.at(-1)).toEqual({ row: 0, message: 'deadline exceeded' });
  });

  it('records a failed import that saved nothing', async () => {
    seedLocations();
    global.__db.batch = jest.fn(() => ({
      set: jest.fn(),
      commit: jest.fn(async () => {
        throw new Error('permission denied');
      }),
    }));

    const result = await run(csv(HEADER, 'Milk,1,gal,Main Fridge'));

    expect(result).toMatchObject({ status: 'failed', itemsImported: 0, itemsSkipped: 1 });
    expect(historyRecord().data.status).toBe('failed');
  });

  it('still reports the import when the history record cannot be written', async () => {
    seedLocations();
    const db = global.__db;
    const realCollection = db.collection;
    db.collection = (name) => {
      const ref = realCollection(name);
      const realDoc = ref.doc;
      ref.doc = (id) => {
        const doc = realDoc(id);
        const realSub = doc.collection;
        doc.collection = (sub) => {
          const subRef = realSub(sub);
          if (sub === 'importHistory') {
            subRef.doc = () => ({
              __path: 'unwritable',
              id: 'unwritable',
              set: async () => {
                throw new Error('history unavailable');
              },
            });
          }
          return subRef;
        };
        return doc;
      };
      return ref;
    };

    const result = await run(csv(HEADER, 'Milk,1,gal,Main Fridge'));

    expect(result).toMatchObject({ status: 'completed', itemsImported: 1, importId: null });
  });
});

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

describe('importInventoryFromCSV handler', () => {
  it('is exported as a deployable function', () => {
    expect(importInventoryFromCSV).toBeDefined();
  });

  it('answers a CORS preflight without touching the database', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'OPTIONS' }), res);

    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(writes).toHaveLength(0);
  });

  it('refuses anything but POST', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);

    expect(res.statusCode).toBe(405);
  });

  it('asks for the fields it needs', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { userId: USER } }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/userId, csvData/);
  });

  it('imports a file posted with a userId', async () => {
    seedLocations();
    const res = makeRes();

    await handler(
      makeReq({
        body: { userId: USER, csvData: csv(HEADER, 'Milk,1,gal,Main Fridge'), fileName: 'k.csv' },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'completed', itemsImported: 1 });
    expect(res.body.timestamp).toEqual(expect.any(String));
    expect(batchedItems()).toHaveLength(1);
  });

  it('answers 400 when the file itself is unusable', async () => {
    seedLocations();
    const res = makeRes();

    await handler(makeReq({ body: { userId: USER, csvData: 'fruit\napples' } }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
  });

  it('imports into the account the ID token names, not the one in the body', async () => {
    collectionGets['users/token-user/storageLocations'] = {
      docs: LOCATIONS.map(({ id, ...data }) => ({ id, data: () => data })),
    };
    const res = makeRes();

    await handler(
      makeReq({
        body: { userId: 'someone-else', csvData: csv(HEADER, 'Milk,1,gal,Main Fridge') },
        headers: { authorization: 'Bearer good-token' },
      }),
      res
    );

    expect(admin.auth().verifyIdToken).toHaveBeenCalledWith('good-token');
    expect(res.statusCode).toBe(200);
    expect(batchedItems()[0].path).toMatch(/^users\/token-user\/inventory\//);
  });

  it('rejects an invalid ID token', async () => {
    global.__auth.verifyIdToken = jest.fn(async () => {
      throw new Error('token expired');
    });
    const res = makeRes();

    await handler(
      makeReq({
        body: { userId: USER, csvData: csv(HEADER, 'Milk,1,gal,Main Fridge') },
        headers: { authorization: 'Bearer stale-token' },
      }),
      res
    );

    expect(res.statusCode).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it('never echoes the token back to the caller', async () => {
    global.__auth.verifyIdToken = jest.fn(async () => {
      throw new Error('token expired');
    });
    const res = makeRes();

    await handler(
      makeReq({
        body: { userId: USER, csvData: 'x' },
        headers: { authorization: 'Bearer super-secret-token' },
      }),
      res
    );

    expect(JSON.stringify(res.body)).not.toMatch(/super-secret-token/);
  });

  it('answers 500 when Firestore itself is unreachable', async () => {
    admin.firestore.mockImplementationOnce(() => {
      throw new Error('firestore unavailable');
    });
    const res = makeRes();

    await handler(makeReq({ body: { userId: USER, csvData: csv(HEADER, 'Milk,1,gal,Fridge') } }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('firestore unavailable');
  });
});
