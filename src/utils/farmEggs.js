// src/utils/farmEggs.js
// The read side of eggs from the farm, for the app: what the Eggs card says
// about where its eggs come from, and whether the farm is supplying them.
//
// MIRRORS functions/src/farm/farmEggs.js (collectedOn, lastCollection,
// isFarmSupplied), which keeps the ledger these read. The app is ESM bundled
// by CRA and that package is CommonJS, so neither imports the other; a change
// to one belongs in both, and src/utils/__tests__/farmEggs.test.js runs both.

export const FARM_SOURCE = 'galaxyfarm';
export const SUPPLYING_DAYS = 14;

/** Today as 'YYYY-MM-DD' on this device's calendar. */
export const localDay = (at = new Date()) => {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addDays = (day, days) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const logEntries = (farm) =>
  Object.entries(farm?.entries || {}).filter(([key]) => key.startsWith('l:'));

/** Is this inventory item fed by the farm at all? */
export const isFromFarm = (item) => item?.farm?.source === FARM_SOURCE;

/** Eggs the ledger says were collected on `day`. */
export const collectedOn = (farm, day) =>
  logEntries(farm)
    .filter(([, entry]) => entry.d === day)
    .reduce((sum, [, entry]) => sum + (Number(entry.n) || 0), 0);

/** The latest day with a collection, or null. */
export const lastCollection = (farm) =>
  logEntries(farm)
    .filter(([, entry]) => entry.n > 0)
    .reduce((latest, [, entry]) => (latest && latest > entry.d ? latest : entry.d), null);

/**
 * True while the farm has collected within SUPPLYING_DAYS of `today`. While it
 * is, the shopping list treats the item as covered: nobody buys eggs the hens
 * are laying.
 */
export const isFarmSupplied = (item, today = localDay()) => {
  if (!isFromFarm(item)) return false;
  const last = lastCollection(item.farm);
  return Boolean(last) && last >= addDays(today, -SUPPLYING_DAYS);
};

const shortDay = (day) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

/** "From Galaxy Farm · 6 collected today", or null for an item not from the farm. */
export const farmLine = (item, today = localDay()) => {
  if (!isFromFarm(item)) return null;
  const name = item.farm.name || 'Galaxy Farm';
  const todayCount = collectedOn(item.farm, today);
  if (todayCount > 0) return `From ${name} · ${todayCount} collected today`;
  const last = lastCollection(item.farm);
  return last ? `From ${name} · last collected ${shortDay(last)}` : `From ${name}`;
};
