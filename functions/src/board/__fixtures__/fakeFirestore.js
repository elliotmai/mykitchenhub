// An in-memory stand-in for the admin Firestore, just big enough for the board
// API: nested collections, where('==' | '>=' | '<=' | 'array-contains'),
// orderBy, limit, get, add, update and getAll. It records every write by path
// so a test can assert *where* a write went, which is the point of an API that
// must never touch another user's data.
//
// Not under __tests__/ because jest would try to run it as a suite.

const SERVER_TIMESTAMP = { __serverTimestamp: true };

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const matches = (data, { field, op, value }) => {
  const actual = data[field];
  switch (op) {
    case '==':
      return actual === value;
    case '>=':
      return actual !== undefined && actual >= value;
    case '<=':
      return actual !== undefined && actual <= value;
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(value);
    default:
      throw new Error(`fake firestore: unsupported op ${op}`);
  }
};

/**
 * @param {Object<string, object>} initial  documents keyed by full path,
 *   e.g. { 'users/u1': {...}, 'users/u1/inventory/i1': {...} }
 */
const makeFakeFirestore = (initial = {}) => {
  const docs = new Map(Object.entries(initial).map(([path, data]) => [path, { ...data }]));
  const writes = [];
  const reads = [];
  let nextId = 1;
  let failWith = null;

  const snapshot = (path) => {
    const data = docs.get(path);
    return {
      id: path.split('/').pop(),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : { ...data }),
      ref: { path },
    };
  };

  const docRef = (path) => ({
    path,
    id: path.split('/').pop(),
    collection: (name) => collectionRef(`${path}/${name}`),
    get: async () => {
      if (failWith) throw failWith;
      reads.push(path);
      return snapshot(path);
    },
    update: async (patch) => {
      if (!docs.has(path)) throw new Error(`fake firestore: no document at ${path}`);
      writes.push({ op: 'update', path, data: patch });
      docs.set(path, { ...docs.get(path), ...patch });
    },
    set: async (data) => {
      writes.push({ op: 'set', path, data });
      docs.set(path, { ...data });
    },
  });

  const collectionRef = (path, filters = [], order = null, max = null) => {
    const run = () => {
      const depth = path.split('/').length + 1;
      let found = [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === depth)
        .filter((key) => filters.every((filter) => matches(docs.get(key), filter)));
      if (order) {
        const sign = order.direction === 'desc' ? -1 : 1;
        found.sort((a, b) => sign * compare(docs.get(a)[order.field], docs.get(b)[order.field]));
      }
      if (max !== null) found = found.slice(0, max);
      return found;
    };

    return {
      path,
      doc: (id) => docRef(`${path}/${id}`),
      where: (field, op, value) =>
        collectionRef(path, [...filters, { field, op, value }], order, max),
      orderBy: (field, direction = 'asc') =>
        collectionRef(path, filters, { field, direction }, max),
      limit: (n) => collectionRef(path, filters, order, n),
      get: async () => {
        if (failWith) throw failWith;
        reads.push(path);
        const found = run();
        return { docs: found.map(snapshot), size: found.length, empty: found.length === 0 };
      },
      add: async (data) => {
        const id = `auto-${nextId++}`;
        const full = `${path}/${id}`;
        writes.push({ op: 'add', path: full, data });
        docs.set(full, { ...data });
        return docRef(full);
      },
    };
  };

  return {
    collection: (name) => collectionRef(name),
    getAll: async (...refs) => {
      if (failWith) throw failWith;
      refs.forEach((ref) => reads.push(ref.path));
      return refs.map((ref) => snapshot(ref.path));
    },
    // Test hooks
    __docs: docs,
    __writes: writes,
    __reads: reads,
    __failWith: (err) => {
      failWith = err;
    },
  };
};

module.exports = { makeFakeFirestore, SERVER_TIMESTAMP };
