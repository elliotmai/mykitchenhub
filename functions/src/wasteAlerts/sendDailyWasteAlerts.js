// functions/src/wasteAlerts/sendDailyWasteAlerts.js
// The 9 AM waste alert — roadmap 6.2.
//
// A Netlify scheduled function (netlify/functions/daily-waste-alerts.mjs)
// runs this at 9 AM in ALERT_TIME_ZONE. For each user it finds what is
// about to expire, texts them if they have asked for texts *and* an SMS
// provider is configured, and always writes an in-app notification so the
// alert lands even with no SMS credential (which is the state today).
//
// The exported handler takes its database (one household's kitchen), its
// clock and its SMS sender as arguments so the tests can drive all three.

const { ALERT_TIME_ZONE, formatAlertMessage, localDay } = require('./alertMessage');
const { sendSms } = require('./smsClient');

/** How far ahead a daily alert looks. */
const ALERT_WINDOW_DAYS = 3;

/** Cap per user, so one overstocked kitchen cannot stall the whole run. */
const MAX_ITEMS_PER_USER = 50;

/** Notification documents older than this are not worth keeping. */
const NOTIFICATION_TYPE = 'waste-alert';

/**
 * The last instant of the day `windowDays` from now.
 *
 * The cutoff is a whole day rather than "now plus N × 24 hours" so that the
 * query and the wording agree: `describeTiming` counts calendar days, so it
 * can say "in 3 days" about an item a rolling cutoff would have left out of
 * the results entirely. Erring a few hours wide costs nothing — the alert is
 * a nudge — while erring narrow drops food off the end of the list.
 */
const endOfWindow = (now, windowDays) => {
  const d = new Date(now);
  d.setDate(d.getDate() + windowDays);
  d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * YYYY-MM-DD, used as the notification's document id so re-runs overwrite.
 *
 * Counted in the timezone the alert is scheduled in, not the server's. The
 * function runs in UTC, so a schedule whose 9 AM falls on the other side of
 * midnight UTC would have stamped the notification with the wrong day and
 * re-run against a fresh id instead of overwriting.
 */
const isoDay = (date) => localDay(new Date(date), ALERT_TIME_ZONE);

/**
 * Has this user opted out of waste alerts entirely?
 *
 * The in-app notification is the default channel, so only an explicit
 * `notifications.expiringSoon === false` (with no SMS request) turns it off.
 */
function wantsWasteAlerts(preferences = {}) {
  const smsEnabled = preferences.smsAlerts?.enabled === true;
  const inAppEnabled = preferences.notifications?.expiringSoon !== false;
  return smsEnabled || inAppEnabled;
}

/**
 * Run the daily sweep.
 *
 * @param {object}   options
 * @param {object}   options.db     - Firestore handle (defaults to the admin one)
 * @param {Date}     options.now    - clock, injected by tests
 * @param {function} options.send   - SMS sender, mocked by tests
 * @param {object}   options.env    - environment, for the SMS credential
 * @returns {Promise<object>} a summary of what the run did
 */
async function runDailyWasteAlerts(options = {}) {
  const {
    db,
    now = new Date(),
    send = sendSms,
    env = process.env,
    windowDays = ALERT_WINDOW_DAYS,
  } = options;

  const summary = {
    usersChecked: 0,
    usersAlerted: 0,
    itemsFlagged: 0,
    smsSent: 0,
    smsSkipped: 0,
    notificationsWritten: 0,
    errors: 0,
  };

  if (!db) throw new Error('runDailyWasteAlerts needs a database.');
  const usersSnapshot = await db.collection('users').get();
  const cutoff = endOfWindow(now, windowDays);

  for (const userDoc of usersSnapshot.docs) {
    summary.usersChecked += 1;

    try {
      const profile = userDoc.data() || {};
      const preferences = profile.preferences || {};

      if (!wantsWasteAlerts(preferences)) continue;

      const inventorySnapshot = await db
        .collection('users')
        .doc(userDoc.id)
        .collection('inventory')
        .where('expiresAt', '<=', cutoff)
        .orderBy('expiresAt', 'asc')
        .limit(MAX_ITEMS_PER_USER)
        .get();

      const items = inventorySnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => item.expiresAt && Number(item.quantity) > 0);

      const message = formatAlertMessage(items, { now });
      if (!message) continue;

      summary.usersAlerted += 1;
      summary.itemsFlagged += items.length;

      // SMS first, so the notification can record whether it went out.
      //
      // Wrapped separately from the per-user handler below: `sendSms` is
      // written never to throw, but if it ever does — a bad provider adapter,
      // an axios upgrade that rejects differently — the failure would fall
      // through to that handler and cost this cook the in-app notification,
      // which is the channel that is supposed to work when texting does not.
      let smsResult = { sent: false, skipped: true, reason: 'not-requested' };
      if (preferences.smsAlerts?.enabled === true) {
        try {
          smsResult = await send(preferences.smsAlerts.phoneNumber, message.sms, { env });
        } catch (smsError) {
          console.error(`SMS sender threw for user ${userDoc.id}: ${smsError.message}`);
          smsResult = { sent: false, skipped: false, reason: 'sender-threw' };
        }
        if (smsResult?.sent) summary.smsSent += 1;
        else summary.smsSkipped += 1;
      }

      // The in-app notification always gets written — it is what makes the
      // feature useful with no SMS provider configured. A deterministic id
      // means a re-run on the same day updates rather than duplicates.
      await db
        .collection('users')
        .doc(userDoc.id)
        .collection('notifications')
        .doc(`${NOTIFICATION_TYPE}-${isoDay(now)}`)
        .set({
          type: NOTIFICATION_TYPE,
          title: message.title,
          body: message.body,
          createdAt: now.toISOString(),
          read: false,
          channel: smsResult?.sent ? 'sms' : 'in-app',
          smsStatus: smsResult?.sent ? 'sent' : (smsResult?.reason ?? 'unknown'),
          itemIds: items.map((item) => item.id),
          itemCount: message.itemCount,
        });

      summary.notificationsWritten += 1;
    } catch (error) {
      // One broken account must not stop everybody else's alerts.
      summary.errors += 1;
      console.error(`Waste alert failed for user ${userDoc.id}: ${error.message}`);
    }
  }

  console.log(
    `Daily waste alerts: ${summary.usersAlerted}/${summary.usersChecked} users alerted, ` +
      `${summary.notificationsWritten} notifications, ${summary.smsSent} texts sent, ` +
      `${summary.smsSkipped} texts skipped, ${summary.errors} errors`
  );

  return summary;
}

/** The hour, 0–23, on the household's clock. */
const ALERT_HOUR = 9;

/**
 * Whether `now` is the 9 o'clock hour in ALERT_TIME_ZONE.
 *
 * Netlify schedules in UTC, and 9 AM in New York is 13:00 or 14:00 UTC
 * depending on daylight saving. The function is scheduled for both and runs
 * only in the one that is 9 AM there — "9 AM" should mean breakfast, and the
 * day arithmetic counts in the same zone, so the text never says "tomorrow"
 * about food the app calls "today".
 */
const isAlertHour = (now = new Date(), timeZone = ALERT_TIME_ZONE) =>
  Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now)
  ) === ALERT_HOUR;

module.exports = {
  ALERT_TIME_ZONE,
  ALERT_WINDOW_DAYS,
  MAX_ITEMS_PER_USER,
  NOTIFICATION_TYPE,
  endOfWindow,
  isoDay,
  wantsWasteAlerts,
  runDailyWasteAlerts,
  ALERT_HOUR,
  isAlertHour,
};
