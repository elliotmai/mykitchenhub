// src/backend/docModel.js
// The rules that make a row of kitchen.docs behave like a Firestore document,
// shared by the browser (./firestore.js) and KitchenHub's server functions
// (netlify/lib/kitchenDb.mjs). Pure: no network, no React.
//
// Paths. The screens still say collection(db, 'users', uid, 'inventory').
// KitchenHub is a household app, so what was each cook's own in Firebase is
// now the household's: users/<anyone>/inventory/x is stored as inventory/x.
// The profile (users/<uid>) and notifications keep their users/<uid>/ path,
// which is what makes them that person's alone (kitchen.docs.owner_id).

import { encode } from './timestamp';

/** Collections under users/{uid}/ that belong to the whole household. */
export const HOUSEHOLD_COLLECTIONS = [
  'storageLocations',
  'inventory',
  'importHistory',
  'deliveries',
  'shoppingItems',
  'mealPlanEntries',
  'mealPlans',
];

const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A 20-character id, like Firestore's. */
export function autoId() {
  let out = '';
  const bytes = new Uint8Array(20);
  const webCrypto = typeof crypto === 'undefined' ? null : crypto; // eslint-disable-line no-undef
  if (webCrypto?.getRandomValues) webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (const b of bytes) out += AUTO_ID_CHARS[b % AUTO_ID_CHARS.length];
  return out;
}

/** Slash-joined segments → the path a row is stored under. */
export function storedPath(segments) {
  const parts = segments.flatMap((s) => String(s).split('/')).filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'users' && HOUSEHOLD_COLLECTIONS.includes(parts[2])) {
    return parts.slice(2).join('/');
  }
  return parts.join('/');
}

/** The collection a stored path sits in ('inventory/x' → 'inventory'). */
export const parentOf = (path) => path.split('/').slice(0, -1).join('/');

// ---------------------------------------------------------------------------
// Write sentinels: serverTimestamp(), increment(), arrayUnion(), arrayRemove(),
// deleteField(). Plain objects with one marker key, so the server's CommonJS
// code (functions/src/utils/fieldValue.js) can make the same ones.
// ---------------------------------------------------------------------------

export const OP = '__kitchenOp';
export const sentinel = (op, value) => ({ [OP]: op, value });
const isSentinel = (v) => v !== null && typeof v === 'object' && typeof v[OP] === 'string';

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function applySentinel(current, s, now) {
  switch (s[OP]) {
    case 'serverTimestamp':
      return { $ts: now };
    case 'increment':
      return (typeof current === 'number' ? current : 0) + Number(s.value || 0);
    case 'arrayUnion': {
      const base = Array.isArray(current) ? [...current] : [];
      for (const item of encode(s.value || []))
        if (!base.some((x) => sameValue(x, item))) base.push(item);
      return base;
    }
    case 'arrayRemove': {
      const drop = encode(s.value || []);
      return (Array.isArray(current) ? current : []).filter(
        (x) => !drop.some((d) => sameValue(x, d))
      );
    }
    case 'delete':
      return undefined;
    default:
      throw new Error(`Unknown field operation ${s[OP]}`);
  }
}

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !isSentinel(v);

/** Encode a value for storage, resolving sentinels against what is there. */
function resolveValue(value, current, now) {
  if (isSentinel(value)) return applySentinel(current, value, now);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, undefined, now));
  if (isPlainObject(value) && !(typeof value.toMillis === 'function') && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const r = resolveValue(v, undefined, now);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return encode(value);
}

/** Deep merge for setDoc(..., { merge: true }): nested maps merge, the rest replaces. */
function mergeInto(target, value, now) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (isSentinel(v)) {
      const r = applySentinel(out[k], v, now);
      if (r === undefined) delete out[k];
      else out[k] = r;
    } else if (
      isPlainObject(v) &&
      typeof v.toMillis !== 'function' &&
      isPlainObject(out[k]) &&
      !('$ts' in out[k])
    ) {
      out[k] = mergeInto(out[k], v, now);
    } else {
      out[k] = resolveValue(v, undefined, now);
    }
  }
  return out;
}

/**
 * The stored JSON after a write.
 *   mode 'set'    replace (or, with merge, deep-merge) the document
 *   mode 'update' set the named fields; 'a.b' reaches into maps
 */
export function applyWrite(
  existing,
  changes,
  { mode = 'set', merge = false, now = Date.now() } = {}
) {
  if (mode === 'set' && !merge) return resolveValue(changes || {}, undefined, now);
  if (mode === 'set') return mergeInto(existing || {}, changes || {}, now);

  const out = JSON.parse(JSON.stringify(existing || {}));
  for (const [key, value] of Object.entries(changes || {})) {
    if (value === undefined) continue;
    const parts = key.split('.');
    let node = out;
    for (const p of parts.slice(0, -1)) {
      if (!isPlainObject(node[p])) node[p] = {};
      node = node[p];
    }
    const last = parts[parts.length - 1];
    const next = resolveValue(value, node[last], now);
    if (next === undefined) delete node[last];
    else node[last] = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queries: where / orderBy / limit, over stored JSON
// ---------------------------------------------------------------------------

const fieldOf = (data, field) =>
  String(field)
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), data);

/** Comparable form: {$ts} → its number. */
const plainOf = (v) =>
  v !== null && typeof v === 'object' && typeof v.$ts === 'number' ? v.$ts : v;

const TYPE_ORDER = (v) =>
  v === null
    ? 0
    : typeof v === 'boolean'
      ? 1
      : typeof v === 'number'
        ? 2
        : typeof v === 'string'
          ? 3
          : 4;

export function compareValues(a, b) {
  const x = plainOf(a);
  const y = plainOf(b);
  const tx = TYPE_ORDER(x);
  const ty = TYPE_ORDER(y);
  if (tx !== ty) return tx - ty;
  if (tx === 4)
    return JSON.stringify(x) < JSON.stringify(y)
      ? -1
      : JSON.stringify(x) > JSON.stringify(y)
        ? 1
        : 0;
  return x < y ? -1 : x > y ? 1 : 0;
}

function passes(data, { field, op, value }) {
  const actual = fieldOf(data, field);
  const want = encode(value);
  switch (op) {
    case '==':
      return actual !== undefined && sameValue(plainOf(actual), plainOf(want));
    case '!=':
      return actual !== undefined && !sameValue(plainOf(actual), plainOf(want));
    case '<':
    case '<=':
    case '>':
    case '>=': {
      if (actual === undefined || actual === null) return false;
      if (TYPE_ORDER(plainOf(actual)) !== TYPE_ORDER(plainOf(want))) return false;
      const c = compareValues(actual, want);
      return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
    }
    case 'array-contains':
      return Array.isArray(actual) && actual.some((x) => sameValue(x, want));
    case 'array-contains-any':
      return Array.isArray(actual) && actual.some((x) => (want || []).some((w) => sameValue(x, w)));
    case 'in':
      return (
        actual !== undefined && (want || []).some((w) => sameValue(plainOf(actual), plainOf(w)))
      );
    case 'not-in':
      return (
        actual !== undefined && !(want || []).some((w) => sameValue(plainOf(actual), plainOf(w)))
      );
    default:
      throw new Error(`Unsupported query operator ${op}`);
  }
}

/**
 * Filter, sort and cut rows ({ path, data }) the way Firestore would: a
 * document without the orderBy field is left out, ties fall back to the id.
 */
export function runQuery(rows, { filters = [], orders = [], limit = null } = {}) {
  let out = rows.filter((r) => filters.every((f) => passes(r.data, f)));
  out = out.filter((r) => orders.every((o) => fieldOf(r.data, o.field) !== undefined));
  out.sort((a, b) => {
    for (const o of orders) {
      const c = compareValues(fieldOf(a.data, o.field), fieldOf(b.data, o.field));
      if (c) return o.direction === 'desc' ? -c : c;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return limit == null ? out : out.slice(0, limit);
}
