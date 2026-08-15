// functions/src/wasteAlerts/alertMessage.js
// Wording for the daily waste alert — roadmap 6.2.
//
// The same facts are phrased twice: a short SMS that has to fit in a couple of
// segments, and a slightly roomier in-app notification. Both are written for
// someone glancing at their phone before the shops shut, not for a developer.

/** SMS gets truncated past this; two segments is plenty for a nudge. */
const SMS_MAX_LENGTH = 300;

/** Named in the SMS; the rest are summarised as "and N more". */
const MAX_NAMED_ITEMS = 3;

/**
 * The household's timezone — the one the Cloud Scheduler trigger fires in.
 *
 * Every "today"/"tomorrow" in this file is counted in it. Without that, day
 * boundaries fell wherever the function happened to run, which is UTC: at the
 * 9 AM New York firing, milk stamped for 23:00 that evening is already the
 * next UTC day, so the text read "milk (tomorrow)" beside a card in the app
 * correctly reading "Expires today".
 *
 * This is one timezone for everybody, not one per cook, because the user
 * profile has nowhere to record a cook's own — see the note in
 * firestore/SCHEMA_DOCUMENTATION.md. Counting in the timezone the alert is
 * scheduled in is at least the same assumption "9 AM" already makes.
 */
const ALERT_TIME_ZONE = 'America/New_York';

/** `YYYY-MM-DD` for an instant, as read off a clock in `timeZone`. */
function localDay(date, timeZone = ALERT_TIME_ZONE) {
  // 'en-CA' formats as YYYY-MM-DD, which is what both the day arithmetic and
  // the notification's document id want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Whole days since the epoch for a local calendar day. */
function dayNumber(date, timeZone) {
  return Math.round(Date.parse(`${localDay(date, timeZone)}T00:00:00Z`) / 86400000);
}

/** Firestore Timestamp, Date or ISO string → Date, or null if unusable. */
function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whole days from `now` until an expiry, counted by calendar day so that
 * "tomorrow" means tomorrow regardless of the time the job runs.
 *
 * Comparing calendar days rather than elapsed hours also means a DST
 * changeover — a 23- or 25-hour day — still counts as one day.
 */
function daysUntil(expiresAt, now = new Date(), timeZone = ALERT_TIME_ZONE) {
  const expiry = toDate(expiresAt);
  if (!expiry) return null;
  return dayNumber(expiry, timeZone) - dayNumber(now, timeZone);
}

/** "expired", "today", "tomorrow", "in 3 days". */
function describeTiming(expiresAt, now = new Date(), timeZone = ALERT_TIME_ZONE) {
  const days = daysUntil(expiresAt, now, timeZone);
  if (days === null) return 'soon';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** Item name with its timing, e.g. "spinach (today)". */
function describeItem(item, now = new Date()) {
  return `${item.name} (${describeTiming(item.expiresAt, now)})`;
}

/** "milk", "milk and eggs", "milk, eggs and yoghurt". */
function joinNames(names) {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Build the alert wording for one cook's expiring items.
 *
 * @param {Array}  items - inventory documents, soonest expiry first
 * @param {object} options
 * @param {Date}   options.now - clock, injectable so tests are not time-dependent
 * @returns {{title: string, body: string, sms: string, itemCount: number}|null}
 *          null when there is nothing worth interrupting someone for.
 */
function formatAlertMessage(items = [], options = {}) {
  const { now = new Date() } = options;
  if (!items.length) return null;

  const expired = items.filter((item) => {
    const days = daysUntil(item.expiresAt, now);
    return days !== null && days < 0;
  });
  const named = items.slice(0, MAX_NAMED_ITEMS);
  const extra = items.length - named.length;

  const countPhrase = `${items.length} item${items.length === 1 ? '' : 's'}`;
  const title =
    expired.length > 0
      ? `${countPhrase} to use up — ${expired.length} already past its date`
      : `${countPhrase} to use up soon`;

  const listing = joinNames(named.map((item) => describeItem(item, now)));
  const andMore = extra > 0 ? `, and ${extra} more` : '';

  const body =
    `${listing}${andMore}. Freeze what you can, or cook something that uses them up — ` +
    'open MyKitchenHub to see suggestions.';

  const sms = `MyKitchenHub: ${countPhrase} to use up — ${listing}${andMore}.`;

  return {
    title,
    body,
    sms: sms.length > SMS_MAX_LENGTH ? `${sms.slice(0, SMS_MAX_LENGTH - 1)}…` : sms,
    itemCount: items.length,
  };
}

module.exports = {
  ALERT_TIME_ZONE,
  SMS_MAX_LENGTH,
  MAX_NAMED_ITEMS,
  daysUntil,
  describeTiming,
  formatAlertMessage,
  localDay,
};
