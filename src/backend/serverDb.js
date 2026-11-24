// src/backend/serverDb.js
// The firebase-admin Firestore calls KitchenHub's server code makes
// (functions/src), answered by one household's rows in a Supabase `docs`
// table: kitchen.docs for the kitchen, letseat.docs for the legacy recipe
// sync. Used by the Netlify functions (netlify/lib/kitchen.mjs) with the
// service role, so the household is always named here, never by a request.
//
// The path rules, write operations and queries are the browser's own
// (./docModel.js), so a row written by either side reads the same on both.

import { Timestamp, decode } from './timestamp';
import { applyWrite, autoId, parentOf, runQuery, storedPath } from './docModel';

const fail = (error) => {
  if (error)
    throw Object.assign(new Error(error.message || 'Database error'), { code: error.code });
};

/**
 * @param {object} options
 * @param {object} options.client       supabase-js client (service role)
 * @param {string} options.householdId  whose rows
 * @param {string} [options.schema]     'kitchen' (default) or 'letseat'
 * @param {boolean} [options.readOnly]  refuse every write (the legacy recipes)
 */
export function makeServerDb({ client, householdId, schema = 'kitchen', readOnly = false }) {
  if (!householdId) throw new Error('A household is required.');
  const table = () => client.schema(schema).from('docs');

  const readRow = async (path) => {
    const { data, error } = await table()
      .select('path, data')
      .eq('household_id', householdId)
      .eq('path', path)
      .maybeSingle();
    fail(error);
    return data ? data.data : null;
  };
  const readRows = async (parent) => {
    let q = table().select('path, data').eq('household_id', householdId);
    if (parent !== null) q = q.eq('parent', parent);
    const { data, error } = await q;
    fail(error);
    return data || [];
  };
  const writeRow = async (path, data) => {
    if (readOnly) throw new Error('This database is read-only.');
    const { error } = await table().upsert(
      { household_id: householdId, path, data, updated_at: new Date().toISOString() },
      { onConflict: 'household_id,path' }
    );
    fail(error);
  };
  const removeRow = async (path) => {
    if (readOnly) throw new Error('This database is read-only.');
    const { error } = await table().delete().eq('household_id', householdId).eq('path', path);
    fail(error);
  };

  const docSnapshot = (path, stored) => {
    const fields = stored == null ? undefined : decode(stored);
    return {
      id: path.split('/').pop(),
      ref: docRef(path),
      exists: stored != null,
      data: () => (fields === undefined ? undefined : { ...fields }),
      get: (field) =>
        String(field)
          .split('.')
          .reduce((node, key) => (node == null ? undefined : node[key]), fields),
    };
  };
  const querySnapshot = (rows) => {
    const docs = rows.map((r) => docSnapshot(r.path, r.data));
    return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
  };

  function docRef(path) {
    const ref = {
      id: path.split('/').pop(),
      path,
      get parent() {
        return collectionRef(parentOf(path));
      },
      collection: (...segments) => collectionRef(storedPath([path, ...segments])),
      get: async () => docSnapshot(path, await readRow(path)),
      set: async (data, options = {}) => {
        const existing = options.merge ? await readRow(path) : null;
        await writeRow(path, applyWrite(existing, data, { mode: 'set', merge: !!options.merge }));
      },
      update: async (changes) => {
        const existing = await readRow(path);
        if (existing == null)
          throw Object.assign(new Error(`No document to update: ${path}`), { code: 5 });
        await writeRow(path, applyWrite(existing, changes, { mode: 'update' }));
      },
      delete: async () => removeRow(path),
    };
    return ref;
  }

  function query(source, spec) {
    const q = {
      where: (field, op, value) =>
        query(source, { ...spec, filters: [...spec.filters, { field, op, value }] }),
      orderBy: (field, direction = 'asc') =>
        query(source, { ...spec, orders: [...spec.orders, { field, direction }] }),
      limit: (n) => query(source, { ...spec, limit: n }),
      startAfter: (ref) =>
        query(source, { ...spec, after: typeof ref === 'string' ? ref : ref.path }),
      get: async () => querySnapshot(await run()),
      count: () => ({
        get: async () => {
          const count = (await run(true)).length;
          return { data: () => ({ count }) };
        },
      }),
    };
    async function run(ignoreLimit = false) {
      const rows = await source();
      const byName = spec.orders.length === 1 && spec.orders[0].field === '__name__';
      // Without an order, runQuery sorts by path: the same as ordering by name.
      let out = runQuery(rows, { filters: spec.filters, orders: byName ? [] : spec.orders });
      if (byName && spec.orders[0].direction === 'desc') out.reverse();
      if (spec.after != null) {
        out = out.filter((r) =>
          byName && spec.orders[0].direction === 'desc' ? r.path < spec.after : r.path > spec.after
        );
      }
      return ignoreLimit || spec.limit == null ? out : out.slice(0, spec.limit);
    }
    return q;
  }

  const blank = { filters: [], orders: [], limit: null, after: null };

  function collectionRef(path) {
    const base = query(() => readRows(path), blank);
    return {
      ...base,
      id: path.split('/').pop(),
      path,
      doc: (id) => docRef(storedPath([path, id ?? autoId()])),
      add: async (data) => {
        const ref = docRef(storedPath([path, autoId()]));
        await ref.set(data);
        return ref;
      },
    };
  }

  return {
    householdId,
    collection: (...segments) => collectionRef(storedPath(segments)),
    doc: (...segments) => docRef(storedPath(segments)),
    collectionGroup: (id) =>
      query(
        async () => (await readRows(null)).filter((r) => parentOf(r.path).split('/').pop() === id),
        blank
      ),
    batch: () => {
      const ops = [];
      const b = {
        set: (ref, data, options) => {
          ops.push(() => ref.set(data, options));
          return b;
        },
        update: (ref, changes) => {
          ops.push(() => ref.update(changes));
          return b;
        },
        delete: (ref) => {
          ops.push(() => ref.delete());
          return b;
        },
        commit: async () => {
          for (const op of ops.splice(0)) await op();
        },
      };
      return b;
    },
    getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
    Timestamp,
  };
}
