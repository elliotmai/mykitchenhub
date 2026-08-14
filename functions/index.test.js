/**
 * Contract tests for the Cloud Functions entry point.
 *
 * These assert the *shape* of the deployed surface — that every function the
 * roadmap promises is exported, and that the shared helpers behave — without
 * requiring credentials or an emulator. Behavioural tests for each function
 * live beside its implementation under src/, and the emulator-backed
 * integration tests live in firestore/tests/.
 *
 * firebase-admin is mocked because index.js calls initializeApp() at import.
 */

jest.mock('firebase-admin', () => {
  const firestore = jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ set: jest.fn(), get: jest.fn(), collection: jest.fn() })),
      get: jest.fn(async () => ({ docs: [], empty: true })),
      where: jest.fn(function where() {
        return this;
      }),
    })),
    batch: jest.fn(() => ({ set: jest.fn(), commit: jest.fn(async () => undefined) })),
  }));
  firestore.FieldValue = {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
    increment: jest.fn((n) => ({ increment: n })),
  };
  firestore.Timestamp = {
    fromDate: jest.fn((d) => ({ toDate: () => d })),
    now: jest.fn(() => ({ toDate: () => new Date() })),
  };

  return {
    initializeApp: jest.fn(),
    apps: [],
    firestore,
    credential: { cert: jest.fn(), applicationDefault: jest.fn() },
  };
});

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({ doc: jest.fn(() => ({ set: jest.fn() })) })),
    batch: jest.fn(() => ({ set: jest.fn(), commit: jest.fn(async () => undefined) })),
  })),
  FieldValue: { serverTimestamp: jest.fn(), increment: jest.fn() },
}));

const functionsIndex = require('./index');

// Every function named in the roadmap (2.2 Cloud Functions Setup) plus the
// storage-location callables added in 3.1.
const REQUIRED_EXPORTS = [
  'syncLegacyRecipes',
  'importInventoryFromCSV',
  'importHelloFreshFromPhoto',
  'importHelloFreshFromUrl',
  'sendDailyWasteAlerts',
  'generateMealPlan',
  'onUserCreated',
  'createStorageLocation',
  'updateStorageLocation',
  'deleteStorageLocation',
];

describe('deployed function surface', () => {
  it.each(REQUIRED_EXPORTS)('exports %s', (name) => {
    expect(functionsIndex[name]).toBeDefined();
  });

  it('exports every function as a callable handler', () => {
    REQUIRED_EXPORTS.forEach((name) => {
      const fn = functionsIndex[name];
      expect(['function', 'object']).toContain(typeof fn);
    });
  });
});

describe('shared helpers', () => {
  const daysFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
  };

  it('exposes helpers for reuse across functions', () => {
    expect(functionsIndex.helpers).toBeDefined();
    expect(typeof functionsIndex.helpers.getExpirationStatus).toBe('function');
  });

  it.each([
    ['expired', -1],
    ['expired', -10],
    ['urgent', 0],
    ['urgent', 2],
    ['warning', 4],
    ['warning', 7],
    ['fresh', 8],
    ['fresh', 90],
  ])('classifies an item expiring in %i days as %s', (expected, days) => {
    expect(functionsIndex.helpers.getExpirationStatus(daysFromNow(days))).toBe(expected);
  });
});
