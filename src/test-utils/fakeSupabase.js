// An in-memory stand-in for the slice of supabase-js the backend uses:
// kitchen.from('docs') with select/eq/maybeSingle/upsert/delete, channels,
// storage and auth. Rows live in `rows` so tests can look at them.

export function makeFakeSupabase() {
  const rows = [];
  const channels = [];
  const parentOf = (p) => p.split('/').slice(0, -1).join('/');
  let failNext = null;

  const builder = () => {
    const filters = [];
    let mode = 'select';
    let payload = null;
    const api = {
      select: () => api,
      eq: (col, v) => {
        filters.push([col, v]);
        return api;
      },
      upsert: (row) => {
        mode = 'upsert';
        payload = row;
        return api;
      },
      delete: () => {
        mode = 'delete';
        return api;
      },
      maybeSingle: () =>
        run().then((r) => (r.error ? r : { data: r.data[0] || null, error: null })),
      then: (resolve, reject) => run().then(resolve, reject),
    };
    const match = (r) =>
      filters.every(([c, v]) => (c === 'parent' ? parentOf(r.path) === v : r[c] === v));
    async function run() {
      if (failNext) {
        const error = failNext;
        failNext = null;
        return { data: null, error };
      }
      if (mode === 'upsert') {
        const i = rows.findIndex(
          (r) => r.household_id === payload.household_id && r.path === payload.path
        );
        const copy = JSON.parse(JSON.stringify(payload));
        if (i >= 0) rows[i] = copy;
        else rows.push(copy);
        return { data: null, error: null };
      }
      if (mode === 'delete') {
        for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
        return { data: null, error: null };
      }
      return {
        data: rows
          .filter(match)
          .map((r) => ({ path: r.path, data: JSON.parse(JSON.stringify(r.data)) })),
        error: null,
      };
    }
    return api;
  };

  const storageCalls = [];
  const supabase = {
    channel: (name) => {
      const ch = {
        name,
        handlers: [],
        on: (_type, _filter, fn) => {
          ch.handlers.push(fn);
          return ch;
        },
        subscribe: () => ch,
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: jest.fn(),
    storage: {
      from: (bucket) => ({
        upload: async (path, file, opts) => {
          storageCalls.push(['upload', bucket, path, opts]);
          return { error: null };
        },
        remove: async (paths) => {
          storageCalls.push(['remove', bucket, paths]);
          return { error: null };
        },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
      }),
    },
  };

  return {
    rows,
    channels,
    storageCalls,
    supabase,
    kitchen: { from: () => builder() },
    failNextWith: (error) => {
      failNext = error;
    },
  };
}
