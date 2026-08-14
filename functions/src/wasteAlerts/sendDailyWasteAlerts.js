// functions/src/wasteAlerts/sendDailyWasteAlerts.js
// The 9 AM waste alert — roadmap 6.2.
//
// Cloud Scheduler triggers this once a day. For each user it finds what is
// about to expire, texts them if they have asked for texts *and* an SMS
// provider is configured, and always writes an in-app notification so the
// alert lands even with no SMS credential (which is the state today).
//
// The exported handler takes its Firestore handle, its clock and its SMS
// sender as arguments so the tests can drive all three.

const functions = require('firebase-functions');
const { getFirestore } = require('firebase-admin/firestore');

const { formatAlertMessage } = require('./alertMessage');
const { sendSms } = require('./smsClient');

/** How far ahead a daily alert looks. */
const ALERT_WINDOW_DAYS = 3;

/** Cap per user, so one overstocked kitchen cannot stall the whole run. */
const MAX_ITEMS_PER_USER = 50;

/** Notification documents older than this are not worth keeping. */
const NOTIFICATION_TYPE = 'waste-alert';

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/** YYYY-MM-DD, used as the notification's document id so re-runs overwrite. */
const isoDay = (date) => new Date(date).toISOString().slice(0, 10);

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
    db = getFirestore(),
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

  const usersSnapshot = await db.collection('users').get();
  const cutoff = addDays(now, windowDays);

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
      let smsResult = { sent: false, skipped: true, reason: 'not-requested' };
      if (preferences.smsAlerts?.enabled === true) {
        smsResult = await send(preferences.smsAlerts.phoneNumber, message.sms, { env });
        if (smsResult.sent) summary.smsSent += 1;
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
          channel: smsResult.sent ? 'sms' : 'in-app',
          smsStatus: smsResult.sent ? 'sent' : smsResult.reason,
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

/**
 * Scheduled function: 9:00 AM daily, via Cloud Scheduler.
 *
 * The timezone is the household's, not UTC — "9 AM" should mean breakfast.
 */
const sendDailyWasteAlerts = functions.pubsub
  .schedule('0 9 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    await runDailyWasteAlerts();
    return null;
  });

module.exports = {
  ALERT_WINDOW_DAYS,
  MAX_ITEMS_PER_USER,
  NOTIFICATION_TYPE,
  wantsWasteAlerts,
  runDailyWasteAlerts,
  sendDailyWasteAlerts,
};
