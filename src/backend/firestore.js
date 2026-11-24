// src/backend/firestore.js
// The Firestore calls KitchenHub's screens make, answered by Supabase.
//
// Each Firestore document is one row of kitchen.docs (Hive's Supabase
// project), keyed by household and path; ./docModel.js has the path rules,
// the write operations and the query engine. Listeners (onSnapshot) are fed
// from Supabase Realtime, and straight after this tab's own writes.

import { kitchen, myHousehold, supabase } from './supabase';
import { Timestamp, decode } from './timestamp';
import { applyWrite, autoId, parentOf, runQuery, sentinel, storedPath } from './docModel';

export { Timestamp };

const fail = (error) => {
  if (!error) return;
  const code =
    error.code === '42501' || /row-level security/i.test(error.message || '')
      ? 'permission-denied'
      : error.code === 'PGRST301' || /JWT/i.test(error.message || '')
        ? 'unauthenticated'
        : /fetch|network/i.test(error.message || '')
          ? 'unavailable'
          : error.code || 'unknown';
  throw Object.assign(new Error(error.message || 'Database error'), { code });
};

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const DB = { kind: 'db' };
export const getFirestore = () => DB;

const colRef = (path) => ({
  kind: 'col',
  type: 'collection',
  path,
  id: path.split('/').pop(),
  firestore: DB,
});
const docRef = (path) => ({
  kind: 'doc',
  type: 'document',
  path,
  id: path.split('/').pop(),
  firestore: DB,
  get parent() {
    return colRef(parentOf(path));
  },
});

const basePath = (base) => (base && base.kind !== 'db' && base.path ? base.path : '');

export function collection(base, ...segments) {
  return colRef(storedPath([basePath(base), ...segments]));
}

export function doc(base, ...segments) {
  if (base?.kind === 'col') return docRef(storedPath([base.path, segments[0] ?? autoId()]));
  return docRef(storedPath([basePath(base), ...segments]));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, direction = 'asc') => ({ kind: 'orderBy', field, direction });
export const limit = (n) => ({ kind: 'limit', n });

export function query(base, ...constraints) {
  const q =
    base.kind === 'query'
      ? { ...base }
      : { kind: 'query', col: base, filters: [], orders: [], limit: null };
  q.filters = [...q.filters];
  q.orders = [...q.orders];
  for (const c of constraints) {
    if (c.kind === 'where') q.filters.push(c);
    else if (c.kind === 'orderBy') q.orders.push(c);
    else if (c.kind === 'limit') q.limit = c.n;
  }
  return q;
}

const asQuery = (target) => (target.kind === 'query' ? target : query(target));

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

function docSnapshot(path, stored) {
  const fields = stored == null ? undefined : decode(stored);
  return {
    id: path.split('/').pop(),
    ref: docRef(path),
    exists: () => stored != null,
    data: () => (fields === undefined ? undefined : { ...fields }),
    get: (field) =>
      String(field)
        .split('.')
        .reduce((node, key) => (node == null ? undefined : node[key]), fields),
  };
}

function querySnapshot(rows) {
  const docs = rows.map((r) => docSnapshot(r.path, r.data));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

async function readRow(path) {
  const hid = await myHousehold();
  const { data, error } = await kitchen
    .from('docs')
    .select('path, data')
    .eq('household_id', hid)
    .eq('path', path)
    .maybeSingle();
  fail(error);
  return data ? data.data : null;
}

async function readCollection(parent) {
  const hid = await myHousehold();
  const { data, error } = await kitchen
    .from('docs')
    .select('path, data')
    .eq('household_id', hid)
    .eq('parent', parent);
  fail(error);
  return data || [];
}

async function writeRow(path, data) {
  const hid = await myHousehold();
  const { error } = await kitchen
    .from('docs')
    .upsert(
      { household_id: hid, path, data, updated_at: new Date().toISOString() },
      { onConflict: 'household_id,path' }
    );
  fail(error);
}

async function removeRow(path) {
  const hid = await myHousehold();
  const { error } = await kitchen.from('docs').delete().eq('household_id', hid).eq('path', path);
  fail(error);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDoc(ref) {
  return docSnapshot(ref.path, await readRow(ref.path));
}

export async function getDocs(target) {
  const q = asQuery(target);
  return querySnapshot(runQuery(await readCollection(q.col.path), q));
}

export async function getCountFromServer(target) {
  const snap = await getDocs(target);
  return { data: () => ({ count: snap.size }) };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const serverTimestamp = () => sentinel('serverTimestamp');
export const increment = (n) => sentinel('increment', n);
export const arrayUnion = (...values) => sentinel('arrayUnion', values);
export const arrayRemove = (...values) => sentinel('arrayRemove', values);
export const deleteField = () => sentinel('delete');

const notFound = (path) =>
  Object.assign(new Error(`No document to update: ${path}`), { code: 'not-found' });

export async function setDoc(ref, data, options = {}) {
  const existing = options.merge ? await readRow(ref.path) : null;
  await writeRow(ref.path, applyWrite(existing, data, { mode: 'set', merge: !!options.merge }));
  changed(ref.path);
}

export async function addDoc(col, data) {
  const ref = doc(col);
  await writeRow(ref.path, applyWrite(null, data, { mode: 'set' }));
  changed(ref.path);
  return ref;
}

export async function updateDoc(ref, changes) {
  const existing = await readRow(ref.path);
  if (existing == null) throw notFound(ref.path);
  await writeRow(ref.path, applyWrite(existing, changes, { mode: 'update' }));
  changed(ref.path);
}

export async function deleteDoc(ref) {
  await removeRow(ref.path);
  changed(ref.path);
}

/** A batch: the writes run in order on commit. */
export function writeBatch() {
  const ops = [];
  const batch = {
    set: (ref, data, options) => {
      ops.push(() => setDoc(ref, data, options));
      return batch;
    },
    update: (ref, changes) => {
      ops.push(() => updateDoc(ref, changes));
      return batch;
    },
    delete: (ref) => {
      ops.push(() => deleteDoc(ref));
      return batch;
    },
    commit: async () => {
      for (const op of ops.splice(0)) await op();
    },
  };
  return batch;
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

const listeners = new Set(); // { watches: parent or path, refresh }
let channel = null;
let channelFor = null;

/** A row at `path` changed (here or elsewhere): refresh whoever watches it. */
function changed(path) {
  const parent = parentOf(path);
  for (const l of listeners) if (l.watches === path || l.watches === parent) l.refresh();
}

async function ensureChannel() {
  const hid = await myHousehold();
  if (channel && channelFor === hid) return;
  if (channel) supabase.removeChannel(channel);
  channelFor = hid;
  channel = supabase
    .channel(`kitchen:${hid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'kitchen', table: 'docs', filter: `household_id=eq.${hid}` },
      (payload) => {
        const path = payload.new?.path || payload.old?.path;
        if (path) changed(path);
        else for (const l of listeners) l.refresh();
      }
    )
    .subscribe();
}

function closeChannelIfIdle() {
  if (listeners.size || !channel) return;
  supabase.removeChannel(channel);
  channel = null;
  channelFor = null;
}

/**
 * Watch a document or a query. Calls `next` with a snapshot now and after
 * every change; `error` with what went wrong. Returns the unsubscribe.
 */
export function onSnapshot(target, nextOrObserver, maybeError) {
  const next = typeof nextOrObserver === 'function' ? nextOrObserver : nextOrObserver?.next;
  const onError = typeof nextOrObserver === 'function' ? maybeError : nextOrObserver?.error;
  const isDoc = target.kind === 'doc';
  const q = isDoc ? null : asQuery(target);
  let live = true;
  let running = null;
  let again = false;

  const load = async () => {
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      try {
        const snap = isDoc
          ? docSnapshot(target.path, await readRow(target.path))
          : querySnapshot(runQuery(await readCollection(q.col.path), q));
        if (live) next?.(snap);
      } catch (err) {
        if (live) onError?.(err);
      }
    })();
    await running;
    running = null;
    if (again && live) {
      again = false;
      load();
    }
  };

  const entry = { watches: isDoc ? target.path : q.col.path, refresh: load };
  listeners.add(entry);
  ensureChannel().catch((err) => live && onError?.(err));
  load();

  return () => {
    live = false;
    listeners.delete(entry);
    closeChannelIfIdle();
  };
}
