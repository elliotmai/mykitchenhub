// src/utils/timestamps.js
// Adapters for the several shapes a "when" can arrive in.
//
// Firestore hands back a Timestamp, `serverTimestamp()` writes resolve to one,
// the emulator seed writes ISO strings, and tests pass plain Dates. Anything
// reading a date off a document has to cope with all four, so it happens here
// once rather than in every consumer.

/**
 * Coerce a Firestore Timestamp / Date / ISO string / epoch millis to a Date.
 *
 * @returns {Date|null} null for anything unparseable, so callers can filter
 *   rather than guard against Invalid Date arithmetic.
 */
export const toDate = (value) => {
  if (!value && value !== 0) return null;

  if (typeof value.toDate === 'function') {
    try {
      const d = value.toDate();
      return Number.isNaN(d?.getTime?.()) ? null : d;
    } catch {
      return null;
    }
  }

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // A pending serverTimestamp() sentinel, or something we don't understand.
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);

  return null;
};

/** Midnight on the Monday of `date`'s week. */
export const startOfWeekMonday = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday, so Sunday belongs to the week that started 6 days ago.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
};

/** Midnight on the Monday *after* `date`'s week — an exclusive upper bound. */
export const endOfWeekMonday = (date = new Date()) => {
  const start = startOfWeekMonday(date);
  start.setDate(start.getDate() + 7);
  return start;
};

/** Whether `value` falls inside the same Monday-based week as `reference`. */
export const isSameWeek = (value, reference = new Date()) => {
  const d = toDate(value);
  if (!d) return false;
  return d >= startOfWeekMonday(reference) && d < endOfWeekMonday(reference);
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
  return year === reference.getFullYear() ? label : `${label} ’${String(year).slice(-2)}`;
};

/** The `count` most recent month keys, oldest first, ending with `date`'s month. */
export const recentMonthKeys = (count, date = new Date()) => {
  const keys = [];
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(monthKey(m));
  }
  return keys;
};
