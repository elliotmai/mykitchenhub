// src/utils/timestamps.js
// Adapters for the several shapes a "when" can arrive in.
//
// Firestore hands back a Timestamp, `serverTimestamp()` writes resolve to one,
// the emulator seed writes ISO strings, and tests pass plain Dates. Anything
// reading a date off a document has to cope with all four, so it happens here
// once rather than in every consumer.

/** `2026-03-01` and nothing else — a calendar day rather than an instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A real, usable Date or nothing. Anything else is a caller's crash later on. */
const asValidDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : null);

/**
 * Parse `YYYY-MM-DD` as local midnight.
 *
 * `new Date('2026-03-01')` is midnight *UTC*, which is the 28th of February
 * anywhere west of Greenwich — so a bare day string would be bucketed into the
 * wrong month, and an imported "best by" date would expire a day early. The
 * rest of the app already treats a bare day as local (see `fromDayKey` in
 * useMealPlan), and this matches it.
 *
 * Returns null for a well-formed but impossible day (`2026-02-31`), which the
 * Date constructor would otherwise silently roll forward into March.
 */
const fromDayString = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  // Years 0–99 mean 1900+n to the Date constructor; say what we meant.
  if (year < 100) d.setFullYear(year);
  const rolledOver = d.getMonth() !== month - 1 || d.getDate() !== day;
  return rolledOver ? null : asValidDate(d);
};

/**
 * Coerce a Firestore Timestamp / Date / ISO string / epoch millis to a Date.
 *
 * @returns {Date|null} null for anything unparseable, so callers can filter
 *   rather than guard against Invalid Date arithmetic.
 */
export const toDate = (value) => {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value.toDate === 'function') {
    try {
      // Not assumed to be a Date: a stub that returns a string would otherwise
      // flow out of here and blow up in the first caller to read .getMonth().
      return asValidDate(value.toDate());
    } catch {
      return null;
    }
  }

  if (value instanceof Date) return asValidDate(value);

  if (typeof value === 'number') return asValidDate(new Date(value));

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DATE_ONLY.test(trimmed)) return fromDayString(trimmed);
    return asValidDate(new Date(trimmed));
  }

  // A pending serverTimestamp() sentinel, or something we don't understand.
  if (typeof value.seconds === 'number') return asValidDate(new Date(value.seconds * 1000));

  return null;
};

/** Sortable `YYYY-MM` bucket key. */
export const monthKey = (date) => {
  const d = toDate(date);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-08` → `Aug`, or `Aug ’25` when the year differs from `reference`. */
export const monthLabel = (key, reference = new Date()) => {
  if (typeof key !== 'string') return '';
  const [year, month] = key.split('-').map(Number);
  const label = MONTH_LABELS[month - 1];
  if (!label) return '';
  const ref = toDate(reference) ?? new Date();
  return year === ref.getFullYear() ? label : `${label} ’${String(year).slice(-2)}`;
};

/**
 * The `count` most recent month keys, oldest first, ending with `date`'s month.
 *
 * Anchored to the 1st of each month so the arithmetic never lands on a day the
 * target month doesn't have (the 31st stepped back a month) and never crosses a
 * DST boundary mid-calculation.
 */
export const recentMonthKeys = (count, date = new Date()) => {
  const anchor = toDate(date) ?? new Date();
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    keys.push(monthKey(new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)));
  }
  return keys;
};
