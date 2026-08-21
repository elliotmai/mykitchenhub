// functions/src/alexa/__fixtures__/fakeFirestore.js
// An in-memory Firestore, enough of one for the Alexa tests.
//
// The account linking tests care about things a stubbed-out `get` cannot show:
// that a code is deleted as it is redeemed, that a token document is keyed by
// the hash rather than the token, that a batch commits as one. So this fake
// keeps real documents in a Map and supports the handful of operations the
// module actually uses — set, add, get, delete, where, batch and transaction.
//
// It lives in __fixtures__ rather than __tests__ because Jest treats every file
// under __tests__ as a suite, and a helper with no tests in it fails the run.

let autoId = 0;

/** Deterministic ids: a test that asserts on one should not be a lottery. */
const nextId = () => `doc-${(autoId += 1)}`;

const parentPath = (path) => path.slice(0, path.lastIndexOf('/'));

const matches = (data, [field, op, value]) => {
  const actual = data?.[field];
  if (op === '==') return actual === value;
  throw new Error(`fakeFirestore does not implement the "${op}" operator.`);
};

function createFirestore(seed = {}) {
  // path → document data, e.g. 'users/u1/shoppingListItems/doc-1'
  const store = new Map(Object.entries(seed));

  const snapshotOf = (path) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    ref: docRef(path),
    exists: store.has(path),
    data: () => (store.has(path) ? { ...store.get(path) } : undefined),
  });

  function docRef(path) {
    return {
      path,
      id: path.slice(path.lastIndexOf('/') + 1),
      async set(data, options = {}) {
        const existing = options.merge ? store.get(path) || {} : {};
        store.set(path, { ...existing, ...data });
      },
      async update(data) {
        if (!store.has(path)) throw new Error(`No document to update at ${path}`);
        store.set(path, { ...store.get(path), ...data });
      },
      async get() {
        return snapshotOf(path);
      },
      async delete() {
        store.delete(path);
      },
      collection: (name) => collectionRef(`${path}/${name}`),
    };
  }

  function collectionRef(path, filters = [], limit = null) {
    return {
      path,
      doc: (id) => docRef(`${path}/${id || nextId()}`),
      where: (field, op, value) => collectionRef(path, [...filters, [field, op, value]], limit),
      limit: (n) => collectionRef(path, filters, n),
      async add(data) {
        const ref = docRef(`${path}/${nextId()}`);
        await ref.set(data);
        return ref;
      },
      async get() {
        const docs = [...store.keys()]
          .filter((key) => parentPath(key) === path)
          .filter((key) => filters.every((filter) => matches(store.get(key), filter)))
          .sort()
          .slice(0, limit ?? undefined)
          .map(snapshotOf);

        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  return {
    __store: store,
    collection: (name) => collectionRef(name),

    batch() {
      const operations = [];
      return {
        set: (ref, data) => operations.push(() => ref.set(data)),
        update: (ref, data) => operations.push(() => ref.update(data)),
        delete: (ref) => operations.push(() => ref.delete()),
        commit: async () => {
          for (const operation of operations) await operation();
        },
      };
    },

    /**
     * No retries and no isolation — the real thing gives both, but the code
     * under test only needs "read, decide, write, all or nothing", and a
     * throwing callback must leave the store untouched.
     */
    async runTransaction(callback) {
      const snapshot = new Map(store);
      const pending = [];
      const transaction = {
        get: (ref) => ref.get(),
        set: (ref, data) => pending.push(() => ref.set(data)),
        delete: (ref) => pending.push(() => ref.delete()),
      };

      try {
        const result = await callback(transaction);
        for (const operation of pending) await operation();
        return result;
      } catch (error) {
        store.clear();
        snapshot.forEach((value, key) => store.set(key, value));
        throw error;
      }
    },
  };
}

module.exports = { createFirestore, __resetIds: () => { autoId = 0; } };
