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

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Firestore Timestamp, Date or ISO string → Date, or null if unusable. */
function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whole days from `now` until an expiry, counted by calendar day so that
 * "tomorrow" means tomorrow regardless of the time the job runs.
 */
function daysUntil(expiresAt, now = new Date()) {
  const expiry = toDate(expiresAt);
  if (!expiry) return null;
  return Math.round((startOfDay(expiry) - startOfDay(now)) / 86400000);
}

/** "expired", "today", "tomorrow", "in 3 days". */
function describeTiming(expiresAt, now = new Date()) {
  const days = daysUntil(expiresAt, now);
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
  SMS_MAX_LENGTH,
  MAX_NAMED_ITEMS,
  daysUntil,
  describeTiming,
  formatAlertMessage,
};
