// src/stores/storeLogic.js
// Shopping by store, the way Let's Eat did it: each line can go to a store
// (Costco, Trader Joe's…), the list can be read store by store, and an item
// remembers where it is usually bought, so "milk" goes to the same store
// next time without asking.
//
// Stores are kitchen.docs 'stores/<id>' ({ name, order }); what an item is
// usually bought at is 'itemStores/<item key>' ({ store, name }). A typed
// line can also carry its own `store`, which wins.

import { ingredientKey } from '../utils/ingredientMeasure';

export const NO_STORE = 'none';

/** The key an item's usual store is remembered under: "Eggs" and "egg" are one item. */
export const itemStoreKey = (name) =>
  (
    ingredientKey(String(name ?? '')) ||
    String(name ?? '')
      .trim()
      .toLowerCase()
  )
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'item';

/** A store's id from its name. */
export const storeIdFor = (name) =>
  String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'store';

/** Stores in the order they were added (then by name). */
export const sortStores = (stores = []) =>
  [...stores].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name))
  );

/**
 * Which store a line goes to: its own store, else where that item is usually
 * bought, else none. A store that no longer exists counts as none.
 */
export function storeFor(item, memory = {}, stores = []) {
  const known = new Set(stores.map((s) => s.id));
  const own = item?.store;
  if (own && known.has(own)) return own;
  const remembered = memory[itemStoreKey(item?.name || item?.normalized)]?.store;
  return remembered && known.has(remembered) ? remembered : NO_STORE;
}

/**
 * Lines grouped store by store, in the stores' order, "No store yet" last.
 * Empty stores are left out. `only` keeps one store (or NO_STORE).
 */
export function groupByStore(rows = [], stores = [], storeOf = () => NO_STORE, only = '') {
  const order = sortStores(stores);
  const groups = new Map([...order.map((s) => [s.id, []]), [NO_STORE, []]]);
  for (const row of rows) {
    const id = storeOf(row);
    (groups.get(id) ?? groups.get(NO_STORE)).push(row);
  }
  const label = (id) => order.find((s) => s.id === id)?.name ?? 'No store yet';
  return [...groups.entries()]
    .filter(([id, list]) => list.length && (!only || only === id))
    .map(([id, list]) => ({
      key: id,
      label: label(id),
      items: [...list].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    }));
}

/** A new store's id, not clashing with an existing one. */
export function newStoreId(name, existing = []) {
  const base = storeIdFor(name);
  const ids = new Set(existing.map((s) => s.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
