// src/test-utils/mocks/firestore.js
// Manual mock for the modular `firebase/firestore` SDK.
//
// Registered globally from src/setupTests.js so no test can reach a real
// Firestore. Writes are recorded as jest.fn() calls; reads are driven by the
// test through the `__` helpers below.
//
// Typical use:
//   import * as fs from '../test-utils/mocks/firestore';
//   render(<Thing />);                                  // hook subscribes
//   act(() => fs.__emit('users/u1/inventory', [        // feed the listener
//     fs.__doc('milk-1', { name: 'Milk' }),
//   ]));

// ---------------------------------------------------------------------------
// Reference helpers
// ---------------------------------------------------------------------------

/** Path of any ref-like value, so tests can assert on where a write went. */
export const pathOf = (ref) => (typeof ref === 'string' ? ref : (ref?.__path ?? ''));

const makeRef = (path, refType) => ({
  __path: path,
  __refType: refType,
  id: path.split('/').filter(Boolean).pop() ?? '',
  path,
});

// `collection(db, 'users', uid, 'inventory')` and `collection(docRef, 'sub')`
// both resolve to a slash-joined path.
const joinFrom = (base, segments) => {
  const prefix = base && base.__path ? base.__path : '';
  return [prefix, ...segments].filter(Boolean).join('/');
};

// ---------------------------------------------------------------------------
// Snapshot factories
// ---------------------------------------------------------------------------

/** Build a DocumentSnapshot-alike. Pass data `null` for a missing document. */
export const __doc = (id, data) => ({
  id,
  ref: makeRef(id, 'doc'),
  exists: () => data !== null && data !== undefined,
  data: () => data ?? undefined,
  get: (field) => data?.[field],
});

/** Build a QuerySnapshot-alike from `__doc` entries. */
export const __querySnapshot = (docs = []) => ({
  docs,
  size: docs.length,
  empty: docs.length === 0,
  forEach: (cb) => docs.forEach(cb),
});

// ---------------------------------------------------------------------------
// Listener registry
// ---------------------------------------------------------------------------

const listeners = new Map(); // path -> Set<{ next, error }>

const listenersFor = (path) => {
  if (!listeners.has(path)) listeners.set(path, new Set());
  return listeners.get(path);
};

/** Push a snapshot to every listener on `path`. Wrap in `act()`. */
export const __emit = (path, docs = []) => {
  const snap = __querySnapshot(docs);
  listenersFor(path).forEach((l) => l.next?.(snap));
};

/** Push a single document snapshot to listeners on `path`. */
export const __emitDoc = (path, id, data) => {
  listenersFor(path).forEach((l) => l.next?.(__doc(id, data)));
};

/** Trigger the error callback for listeners on `path`. */
export const __emitError = (path, error = new Error('firestore failure')) => {
  listenersFor(path).forEach((l) => l.error?.(error));
};

/** How many live listeners exist on `path` — used to assert cleanup. */
export const __listenerCount = (path) => listenersFor(path).size;

/** All paths currently subscribed. */
export const __listenerPaths = () => [...listeners.keys()].filter((p) => listeners.get(p).size > 0);

// ---------------------------------------------------------------------------
// SDK surface
// ---------------------------------------------------------------------------

export const getFirestore = jest.fn(() => ({ __path: '', __refType: 'firestore' }));
export const connectFirestoreEmulator = jest.fn();
export const initializeFirestore = jest.fn(() => ({ __path: '', __refType: 'firestore' }));
export const enableIndexedDbPersistence = jest.fn(() => Promise.resolve());

// Offline cache builders (src/services/firebase.js). They only ever get handed
// straight back to initializeFirestore, so recording the call is enough.
export const persistentLocalCache = jest.fn((settings) => ({
  __cache: 'persistent',
  ...settings,
}));
export const persistentMultipleTabManager = jest.fn(() => ({ __tabManager: 'multi' }));
export const memoryLocalCache = jest.fn(() => ({ __cache: 'memory' }));

export const collection = jest.fn((base, ...segments) =>
  makeRef(joinFrom(base, segments), 'collection')
);
export const collectionGroup = jest.fn((_db, id) => makeRef(id, 'collectionGroup'));
export const doc = jest.fn((base, ...segments) => makeRef(joinFrom(base, segments), 'doc'));

export const query = jest.fn((ref, ...constraints) => ({ ...ref, __constraints: constraints }));
export const where = jest.fn((field, op, value) => ({ type: 'where', field, op, value }));
export const orderBy = jest.fn((field, direction = 'asc') => ({
  type: 'orderBy',
  field,
  direction,
}));
export const limit = jest.fn((count) => ({ type: 'limit', count }));
export const startAfter = jest.fn((...v) => ({ type: 'startAfter', values: v }));
export const documentId = jest.fn(() => '__name__');

export const onSnapshot = jest.fn((ref, a, b) => {
  // Supports both (ref, next, error) and (ref, { next, error }) call shapes.
  const handlers =
    typeof a === 'function' ? { next: a, error: b } : { next: a?.next, error: a?.error };
  const path = pathOf(ref);
  const set = listenersFor(path);
  set.add(handlers);
  return () => set.delete(handlers);
});

// Reads default to empty; override per test with mockResolvedValueOnce.
export const getDoc = jest.fn(async (ref) => __doc(pathOf(ref).split('/').pop() ?? 'doc', null));
export const getDocs = jest.fn(async () => __querySnapshot([]));
// Aggregation query — returns `{ data: () => ({ count }) }` like the real SDK.
export const getCountFromServer = jest.fn(async () => ({ data: () => ({ count: 0 }) }));

// Writes.
let autoId = 0;
export const addDoc = jest.fn(async (ref) =>
  makeRef(`${pathOf(ref)}/generated-${++autoId}`, 'doc')
);
export const setDoc = jest.fn(async () => undefined);
export const updateDoc = jest.fn(async () => undefined);
export const deleteDoc = jest.fn(async () => undefined);

export const runTransaction = jest.fn(async (_db, updateFn) =>
  updateFn({
    get: getDoc,
    set: setDoc,
    update: updateDoc,
    delete: deleteDoc,
  })
);

export const writeBatch = jest.fn(() => ({
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn(async () => undefined),
}));

// Field values — returned as inspectable sentinels rather than opaque objects
// so assertions can check *intent* (e.g. "quantity was incremented by 1").
export const serverTimestamp = jest.fn(() => ({ __sentinel: 'serverTimestamp' }));
export const increment = jest.fn((n) => ({ __sentinel: 'increment', by: n }));
export const arrayUnion = jest.fn((...values) => ({ __sentinel: 'arrayUnion', values }));
export const arrayRemove = jest.fn((...values) => ({ __sentinel: 'arrayRemove', values }));
export const deleteField = jest.fn(() => ({ __sentinel: 'deleteField' }));

export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static fromDate(date) {
    return new Timestamp(Math.floor(date.getTime() / 1000));
  }

  static now() {
    return Timestamp.fromDate(new Date());
  }

  toDate() {
    return new Date(this.seconds * 1000);
  }

  toMillis() {
    return this.seconds * 1000;
  }
}

// ---------------------------------------------------------------------------
// Reset — called from the global beforeEach in setupTests.js
// ---------------------------------------------------------------------------

export const __reset = () => {
  listeners.clear();
  autoId = 0;
  getDoc.mockImplementation(async (ref) => __doc(pathOf(ref).split('/').pop() ?? 'doc', null));
  getDocs.mockImplementation(async () => __querySnapshot([]));
  getCountFromServer.mockImplementation(async () => ({ data: () => ({ count: 0 }) }));
  addDoc.mockImplementation(async (ref) => makeRef(`${pathOf(ref)}/generated-${++autoId}`, 'doc'));
  setDoc.mockImplementation(async () => undefined);
  updateDoc.mockImplementation(async () => undefined);
  deleteDoc.mockImplementation(async () => undefined);
};
