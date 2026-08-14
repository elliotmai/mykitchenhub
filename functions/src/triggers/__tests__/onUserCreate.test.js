/**
 * Signup provisioning: this trigger is the only thing standing between a new
 * account and an unusable, empty kitchen. It writes the user document, the
 * default storage locations, and the recipe-sync bookkeeping doc.
 *
 * firebase-admin is mocked with a recording fake so the tests can assert on
 * *what* was written to *which* path without an emulator.
 */

const mockBatch = () => ({
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn(async () => undefined),
});

let batches;
let writes;
let collectionGets;

/** Builds a chainable Firestore fake that records every set() by path. */
const makeDb = () => {
  const docRef = (path) => ({
    __path: path,
    set: jest.fn(async (data) => {
      writes.push({ path, data });
    }),
    update: jest.fn(async (data) => {
      writes.push({ path, data, update: true });
    }),
    collection: (name) => collectionRef(`${path}/${name}`),
  });

  const collectionRef = (path) => ({
    __path: path,
    doc: (id) => docRef(`${path}/${id ?? `auto-${Math.random().toString(36).slice(2, 8)}`}`),
    get: jest.fn(async () => collectionGets[path] ?? { docs: [], empty: true, size: 0 }),
  });

  return {
    collection: (name) => collectionRef(name),
    batch: jest.fn(() => {
      const b = mockBatch();
      batches.push(b);
      return b;
    }),
  };
};

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
}));

const { getFirestore } = require('firebase-admin/firestore');
const { onUserCreate, addStorageLocations } = require('../onUserCreate');
const { getDefaultLocations } = require('../../data/defaultLocations');

const NEW_USER = { uid: 'user-123', email: 'cook@example.com', displayName: 'Chef Eli' };

beforeEach(() => {
  batches = [];
  writes = [];
  collectionGets = {};
  getFirestore.mockReturnValue(makeDb());
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const writeTo = (path) => writes.find((w) => w.path === path);
const batchedLocations = () =>
  batches.flatMap((b) => b.set.mock.calls.map(([ref, data]) => ({ path: ref.__path, data })));

describe('onUserCreate', () => {
  it('reports how many locations it created', async () => {
    const result = await onUserCreate(NEW_USER);

    expect(result.success).toBe(true);
    expect(result.userId).toBe('user-123');
    expect(result.locationsCreated).toBe(getDefaultLocations(true).length);
  });

  it('creates the user document at users/{uid}', async () => {
    await onUserCreate(NEW_USER);

    const doc = writeTo('users/user-123');
    expect(doc).toBeDefined();
    expect(doc.data.email).toBe('cook@example.com');
    expect(doc.data.displayName).toBe('Chef Eli');
    expect(doc.data.createdAt).toEqual(expect.any(String));
  });

  it('derives a display name from the email when none is given', async () => {
    await onUserCreate({ uid: 'user-123', email: 'solo.cook@example.com' });

    expect(writeTo('users/user-123').data.displayName).toBe('solo.cook');
  });

  it('starts every new account with waste alerts off and no phone number', async () => {
    await onUserCreate(NEW_USER);

    const { preferences } = writeTo('users/user-123').data;
    expect(preferences.smsAlerts.enabled).toBe(false);
    expect(preferences.smsAlerts.phoneNumber).toBe('');
  });

  it('zeroes the stats counters', async () => {
    await onUserCreate(NEW_USER);

    expect(writeTo('users/user-123').data.stats).toEqual({
      totalRecipes: 0,
      totalItems: 0,
      wasteReduction: 0,
    });
  });

  it('seeds the default storage locations in one batch', async () => {
    await onUserCreate(NEW_USER);

    const created = batchedLocations();
    expect(created).toHaveLength(getDefaultLocations(true).length);
    created.forEach(({ path }) => expect(path).toMatch(/^users\/user-123\/storageLocations\//));
    expect(batches[0].commit).toHaveBeenCalled();
  });

  it('gives each seeded location the label the UI reads', async () => {
    await onUserCreate(NEW_USER);

    const labels = batchedLocations().map(({ data }) => data.label);
    expect(labels).toEqual(expect.arrayContaining(['Main Fridge', 'Freezer', 'Pantry']));
    labels.forEach((label) => expect(typeof label).toBe('string'));
  });

  it('stamps each seeded location with createdAt and a zero item count', async () => {
    await onUserCreate(NEW_USER);

    batchedLocations().forEach(({ data }) => {
      expect(data.createdAt).toEqual(expect.any(String));
      expect(data.itemCount).toBe(0);
    });
  });

  it('creates the recipe sync bookkeeping document as pending', async () => {
    await onUserCreate(NEW_USER);

    const sync = writeTo('users/user-123/syncMetadata/recipesSync');
    expect(sync).toBeDefined();
    expect(sync.data.syncStatus).toBe('pending');
    expect(sync.data.totalRecipesSynced).toBe(0);
    expect(sync.data.lastSyncAt).toBeNull();
  });

  it('propagates a write failure instead of reporting a half-built account', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = makeDb();
    db.collection = () => ({
      doc: () => ({
        __path: 'users/user-123',
        set: jest.fn(async () => {
          throw new Error('permission denied');
        }),
        collection: () => ({ doc: () => ({}) }),
      }),
    });
    getFirestore.mockReturnValue(db);

    await expect(onUserCreate(NEW_USER)).rejects.toThrow('permission denied');
  });
});

describe('addStorageLocations', () => {
  it('batches the given locations under the user and returns the count', async () => {
    const count = await addStorageLocations('user-123', [
      { label: 'Beer Fridge', type: 'fridge', icon: '🍺', color: '#123456', order: 9, isDefault: false },
    ]);

    expect(count).toBe(1);
    const created = batchedLocations();
    expect(created).toHaveLength(1);
    expect(created[0].data.label).toBe('Beer Fridge');
    expect(created[0].data.itemCount).toBe(0);
    expect(created[0].path).toMatch(/^users\/user-123\/storageLocations\//);
  });

  it('commits nothing but still succeeds for an empty list', async () => {
    const count = await addStorageLocations('user-123', []);

    expect(count).toBe(0);
    expect(batchedLocations()).toEqual([]);
    expect(batches[0].commit).toHaveBeenCalled();
  });
});
