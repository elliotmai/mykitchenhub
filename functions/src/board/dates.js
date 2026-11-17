// functions/src/board/dates.js
// Calendar days in the cook's own timezone, for the `board` API.
//
// The app counts days on the browser's clock. A Cloud Function runs in UTC,
// so every "today" here is read off a clock in the cook's timezone instead —
// otherwise from late afternoon in Chicago the board would already be showing
// tomorrow's meals. Day keys are `YYYY-MM-DD` strings, as everywhere else.

const { localDay, daysUntil } = require('../wasteAlerts/alertMessage');

/** Used when the user document records no `timezone` of its own. */
const DEFAULT_TIME_ZONE = 'America/Chicago';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** True when `zone` is an IANA name this runtime understands. */
const isValidTimeZone = (zone) => {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** The user's timezone, or the default when theirs is missing or unreadable. */
const resolveTimeZone = (zone) => (isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE);

/** Today's day key for a clock in `timeZone`. */
const todayIn = (timeZone, now = new Date()) => localDay(now, timeZone);

/**
 * Shift a day key by whole calendar days.
 *
 * Done on the date alone, at UTC midnight, so no timezone or DST change can
 * turn "plus one day" into "plus 23 hours".
 */
const shiftDayKey = (key, days) => {
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

/** The Monday of the week containing `key` — what the app's week view starts on. */
const startOfWeekKey = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return shiftDayKey(key, -weekday);
};

/** Firestore Timestamp, Date, ISO string or `{seconds}` → Date, or null. */
const toDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  let date;
  if (typeof value.toDate === 'function') date = value.toDate();
  else if (
    typeof value === 'object' &&
    typeof value.seconds === 'number' &&
    !(value instanceof Date)
  ) {
    date = new Date(value.seconds * 1000);
  } else date = new Date(value);
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
};

module.exports = {
  DEFAULT_TIME_ZONE,
  DAY_KEY,
  isValidTimeZone,
  resolveTimeZone,
  todayIn,
  shiftDayKey,
  startOfWeekKey,
  toDate,
  localDay,
  daysUntil,
};
