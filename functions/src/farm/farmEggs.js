// functions/src/farm/farmEggs.js
// Eggs from the farm: Galaxy Farm's egg logs and dispositions, kept in step
// with the kitchen's one "Eggs" inventory item (POST /api/farm/eggs,
// netlify/functions/farm-eggs.mjs).
//
// The farm sends the *current state* of each record it has changed — not a
// delta — with a version (the farm's server-side updatedAt). The item keeps a
// small ledger, `farm.entries`, of what each farm record last contributed:
//
//   collected log            +total
//   given / sold disposition −quantity
//   kept disposition          0  (still in the kitchen)
//   deleted (tombstoned)      0
//
// so the change to the stock is always new contribution − old contribution.
// A version that is not newer than the one held changes nothing. That makes
// every send idempotent: the farm is offline-first and its pushes can arrive
// late, twice, or out of order, and none of those can count an egg twice.
//
// Cooking and manual edits change `quantity` directly and never touch the
// ledger, so the two compose: the farm only ever moves the stock by the
// difference its own records made.
//
// Pure: no I/O, no clock unless one is passed. src/utils/farmEggs.js mirrors
// the read side (the card's line, "is the farm supplying") for the app.

const FARM_NAME = 'Galaxy Farm';
const SOURCE = 'galaxyfarm';
/** The item this endpoint creates when the kitchen has none. */
const EGGS_ITEM_ID = 'galaxyfarm-eggs';
const EGG_SHELF_LIFE_DAYS = 35;
/** Ledger entries older than this (by the record's date) are dropped. */
const LEDGER_DAYS = 120;
/** A new ledger accepts records dated this many days before it existed. */
const START_GRACE_DAYS = 3;
/** "While the farm is supplying them": a collection inside this many days. */
const SUPPLYING_DAYS = 14;
const MAX_RECORDS = 200;
const DAY_MS = 86_400_000;

const TYPES = ['log', 'disposition'];
const DISPOSITION_KINDS = ['kept', 'given', 'sold'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9A-Za-z_-]{1,64}$/;

class FarmEggsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isDay = (value) =>
  typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** 'YYYY-MM-DD' shifted by whole days. */
const addDays = (day, days) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** A calendar day in a timezone (the household's, or the server's when unknown). */
const dayIn = (at, timeZone) => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
};

/**
 * One record off the wire, checked, or `{ error }` saying why not.
 * The batch as a whole is refused only when it is not a batch at all.
 */
const cleanRecord = (raw) => {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const { id, type, version, date, quantity, kind, deleted } = raw;
  if (typeof id !== 'string' || !ID.test(id)) return { error: 'id is missing or malformed' };
  if (!TYPES.includes(type)) return { id, error: 'type must be log or disposition' };
  const at = typeof version === 'string' ? Date.parse(version) : NaN;
  if (Number.isNaN(at)) return { id, error: 'version must be a timestamp' };
  if (!isDay(date)) return { id, error: 'date must be YYYY-MM-DD' };
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100_000)
    return { id, error: 'quantity must be a whole number, 0 or more' };
  if (type === 'disposition' && !DISPOSITION_KINDS.includes(kind))
    return { id, error: 'kind must be kept, given or sold' };
  if (deleted !== undefined && typeof deleted !== 'boolean')
    return { id, error: 'deleted must be true or false' };
  return {
    record: {
      id,
      type,
      version: at,
      date,
      quantity,
      kind: type === 'disposition' ? kind : undefined,
      deleted: deleted === true,
    },
  };
};

/** The request body → { records, rejected }, or a 400. */
const parseBatch = (body) => {
  const list = body && Array.isArray(body.records) ? body.records : null;
  if (!list) throw new FarmEggsError(400, 'records must be a list.');
  if (list.length === 0) throw new FarmEggsError(400, 'records is empty.');
  if (list.length > MAX_RECORDS)
    throw new FarmEggsError(400, `Send at most ${MAX_RECORDS} records at a time.`);
  const records = [];
  const rejected = [];
  list.forEach((raw) => {
    const { record, id, error } = cleanRecord(raw);
    if (record) records.push(record);
    else
      rejected.push({
        id: id ?? (raw && typeof raw.id === 'string' ? raw.id : null),
        reason: error,
      });
  });
  return { records, rejected };
};

/** What a record adds to (or takes from) the kitchen's stock as it stands now. */
const contribution = (record) => {
  if (record.deleted) return 0;
  if (record.type === 'log') return record.quantity;
  return record.kind === 'kept' ? 0 : -record.quantity;
};

const ledgerKey = (record) => `${record.type === 'log' ? 'l' : 'd'}:${record.id}`;

/**
 * Apply a batch to the stored item (raw kitchen.docs JSON, timestamps as
 * {$ts}). Returns the next data, or the same object when nothing changed,
 * and what happened to each record.
 *
 * @param {object} data      the Eggs item as stored
 * @param {object[]} records from parseBatch
 * @param {{ now: Date, today: string }} clock  `today` is the household's day
 */
const applyFarmEggs = (data, records, { now, today }) => {
  const farm = data.farm && typeof data.farm === 'object' ? data.farm : {};
  const entries = { ...(farm.entries || {}) };
  const horizon = isDay(farm.horizon) ? farm.horizon : addDays(today, -START_GRACE_DAYS);

  const applied = [];
  const unchanged = [];
  const ignored = [];
  let delta = 0;
  let freshCollection = false;

  // Oldest version first, so two versions of one record in one batch land in order.
  [...records]
    .sort((a, b) => a.version - b.version)
    .forEach((record) => {
      const key = ledgerKey(record);
      const held = entries[key];
      if (held && record.version <= held.v) {
        unchanged.push(record.id);
        return;
      }
      if (!held && record.date < horizon) {
        // Older than anything this item has tracked: those eggs were never
        // counted here, so neither is the change to them.
        ignored.push({ id: record.id, reason: 'before the kitchen tracked farm eggs' });
        return;
      }
      const next = contribution(record);
      const previous = held ? held.n : 0;
      delta += next - previous;
      if (record.type === 'log' && next > previous) freshCollection = true;
      entries[key] = {
        v: record.version,
        n: next,
        d: record.date,
        ...(record.type === 'log' ? {} : { k: record.kind }),
      };
      applied.push(record.id);
    });

  if (applied.length === 0 && isDay(farm.horizon)) {
    return { data, changed: false, delta: 0, applied, unchanged, ignored };
  }

  // Forget what is too old to be edited usefully, and move the horizon with it.
  const cutoff = addDays(today, -LEDGER_DAYS);
  const nextHorizon = horizon > cutoff ? horizon : cutoff;
  Object.keys(entries).forEach((key) => {
    if (entries[key].d < nextHorizon) delete entries[key];
  });

  const before = Number(data.quantity) || 0;
  const quantity = Math.max(0, Math.round((before + delta) * 100) / 100);
  const next = {
    ...data,
    quantity,
    farm: {
      source: SOURCE,
      name: FARM_NAME,
      horizon: nextHorizon,
      entries,
      syncedAt: { $ts: now.getTime() },
    },
    updatedAt: { $ts: now.getTime() },
  };
  // A box that was empty and has just been filled keeps from today.
  if (freshCollection && before <= 0 && data.alwaysHave !== true) {
    next.expiresAt = { $ts: now.getTime() + EGG_SHELF_LIFE_DAYS * DAY_MS };
  }
  return { data: next, changed: true, delta, applied, unchanged, ignored };
};

/** A fresh Eggs item in the given fridge, before any farm record is applied. */
const newEggsItem = ({ location, now, today }) => ({
  name: 'Eggs',
  normalized: 'eggs',
  quantity: 0,
  // Counted, not weighed: a recipe's "2 eggs" carries no unit either.
  unit: '',
  locationId: location?.id || 'unassigned',
  locationType: 'fridge',
  addedAt: { $ts: now.getTime() },
  expiresAt: { $ts: now.getTime() + EGG_SHELF_LIFE_DAYS * DAY_MS },
  shelfLifeDays: EGG_SHELF_LIFE_DAYS,
  shelfLifeSource: 'default',
  notes: '',
  alwaysHave: false,
  alsoCovers: [],
  source: SOURCE,
  purchaseHistory: [],
  totalTimesPurchased: 0,
  farm: {
    source: SOURCE,
    name: FARM_NAME,
    horizon: addDays(today, -START_GRACE_DAYS),
    entries: {},
  },
});

const isEggsName = (name) =>
  /^eggs?$/.test(
    String(name ?? '')
      .trim()
      .toLowerCase()
  );

/**
 * Which inventory row is "Eggs": the one already fed by the farm, else one
 * the cook made in a fridge, else any one named eggs. Null when there is none.
 *
 * @param {{ path: string, data: object }[]} rows  the household's inventory
 */
const pickEggsItem = (rows) => {
  const eggs = rows.filter((row) => row.data && isEggsName(row.data.normalized || row.data.name));
  return (
    eggs.find((row) => row.data.farm?.source === SOURCE) ||
    eggs.find((row) => row.data.locationType === 'fridge') ||
    eggs[0] ||
    null
  );
};

/** The household's fridge: a default fridge first, then the lowest order. */
const pickFridge = (locations) => {
  const fridges = locations
    .filter((loc) => loc.data?.type === 'fridge')
    .sort(
      (a, b) =>
        Number(b.data.isDefault === true) - Number(a.data.isDefault === true) ||
        (Number(a.data.order) || 0) - (Number(b.data.order) || 0)
    );
  const chosen = fridges[0];
  return chosen ? { id: chosen.path.split('/').pop() } : null;
};

/** Eggs collected on `day` according to the ledger. */
const collectedOn = (farm, day) =>
  Object.entries(farm?.entries || {})
    .filter(([key, entry]) => key.startsWith('l:') && entry.d === day)
    .reduce((sum, [, entry]) => sum + (Number(entry.n) || 0), 0);

/** The latest day the ledger has a collection on, or null. */
const lastCollection = (farm) =>
  Object.entries(farm?.entries || {})
    .filter(([key, entry]) => key.startsWith('l:') && entry.n > 0)
    .reduce((latest, [, entry]) => (latest && latest > entry.d ? latest : entry.d), null);

/** True while the farm has collected eggs within SUPPLYING_DAYS of `today`. */
const isFarmSupplied = (item, today) => {
  if (item?.farm?.source !== SOURCE || !isDay(today)) return false;
  const last = lastCollection(item.farm);
  return Boolean(last) && last >= addDays(today, -SUPPLYING_DAYS);
};

module.exports = {
  FARM_NAME,
  SOURCE,
  EGGS_ITEM_ID,
  EGG_SHELF_LIFE_DAYS,
  LEDGER_DAYS,
  START_GRACE_DAYS,
  SUPPLYING_DAYS,
  MAX_RECORDS,
  FarmEggsError,
  addDays,
  dayIn,
  parseBatch,
  contribution,
  applyFarmEggs,
  newEggsItem,
  pickEggsItem,
  pickFridge,
  collectedOn,
  lastCollection,
  isFarmSupplied,
};
