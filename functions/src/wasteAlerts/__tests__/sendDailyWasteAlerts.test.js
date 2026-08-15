/**
 * The nightly waste alert sweep.
 *
 * firebase-admin is mocked with a recording fake so the tests can assert on
 * *what* was written to *which* path without an emulator, the clock is
 * injected, and the SMS client is a jest.fn() — nothing here can send a real
 * text or cost money.
 */

let writes;
let inventories;
let queries;

/** A chainable Firestore fake that records every set() by path. */
const makeDb = (users = [], inventoryByUser = {}) => {
  inventories = inventoryByUser;

  const docSnapshot = (id, data) => ({ id, data: () => data, exists: true });

  const inventoryQuery = (uid) => {
    const chain = {
      // Recorded and actually applied: a fake that ignored the bound would let
      // a wrong cutoff pass every assertion below.
      where: (field, op, value) => {
        queries.push({ uid, field, op, value });
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      get: async () => {
        const bound = queries.filter((q) => q.uid === uid && q.field === 'expiresAt').pop();
        const items = (inventories[uid] ?? []).filter(
          (item) => !bound || !item.expiresAt || item.expiresAt <= bound.value
        );
        return { docs: items.map(({ id, ...data }) => docSnapshot(id, data)), size: items.length };
      },
    };
    return chain;
  };

  const notificationDoc = (path) => ({
    __path: path,
    set: jest.fn(async (data) => {
      writes.push({ path, data });
    }),
  });

  return {
    collection: (name) => ({
      get: async () => ({
        docs: users.map(({ id, ...data }) => docSnapshot(id, data)),
        size: users.length,
      }),
      doc: (uid) => ({
        collection: (sub) =>
          sub === 'inventory'
            ? inventoryQuery(uid)
            : { doc: (id) => notificationDoc(`${name}/${uid}/${sub}/${id}`) },
      }),
    }),
  };
};

const {
  runDailyWasteAlerts,
  wantsWasteAlerts,
  endOfWindow,
  isoDay,
  ALERT_TIME_ZONE,
  ALERT_WINDOW_DAYS,
  NOTIFICATION_TYPE,
} = require('../sendDailyWasteAlerts');

const NOW = new Date('2026-08-14T13:00:00Z');

const user = (id, preferences) => ({ id, preferences });

const alertingUser = (id = 'user-1', overrides = {}) =>
  user(id, {
    smsAlerts: { enabled: false, phoneNumber: '', time: '09:00' },
    notifications: { expiringSoon: true },
    ...overrides,
  });

const expiringItem = (id, name, iso) => ({
  id,
  name,
  quantity: 1,
  expiresAt: new Date(iso),
});

/** An SMS sender that never touches the network. */
const mockSender = (result = { sent: true, skipped: false, reason: null }) =>
  jest.fn(async () => result);

beforeEach(() => {
  writes = [];
  queries = [];
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const notificationFor = (uid) =>
  writes.find((w) => w.path.startsWith(`users/${uid}/notifications/`));

describe('wantsWasteAlerts', () => {
  it('says yes by default — a new account gets its alerts', () => {
    expect(wantsWasteAlerts({})).toBe(true);
  });

  it('says no when the cook has switched in-app alerts off and wants no texts', () => {
    expect(wantsWasteAlerts({ notifications: { expiringSoon: false } })).toBe(false);
  });

  it('still says yes when they want texts but not the in-app list', () => {
    expect(
      wantsWasteAlerts({
        notifications: { expiringSoon: false },
        smsAlerts: { enabled: true },
      })
    ).toBe(true);
  });
});

describe('the alert window', () => {
  it('runs to the end of the last day, not to this time of day N days out', () => {
    // At a 9 AM run a rolling "now + 3 × 24h" cutoff stops at 9 AM three days
    // later, so food going off that evening never reaches the query — while
    // the wording, which counts calendar days, would have called it
    // "in 3 days" had it arrived.
    const cutoff = endOfWindow(new Date('2026-08-14T09:00:00'), 3);

    expect(cutoff.getFullYear()).toBe(2026);
    expect(cutoff.getMonth()).toBe(7);
    expect(cutoff.getDate()).toBe(17);
    expect(cutoff.getHours()).toBe(23);
    expect(cutoff.getMinutes()).toBe(59);
  });

  it('asks Firestore for that cutoff', async () => {
    const db = makeDb([alertingUser()], { 'user-1': [] });

    await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    const bound = queries.find((q) => q.field === 'expiresAt');
    expect(bound.op).toBe('<=');
    expect(bound.value).toEqual(endOfWindow(NOW, ALERT_WINDOW_DAYS));
  });

  it('reaches food expiring late on the last day of the window', async () => {
    const db = makeDb([alertingUser()], {
      // NOW is 2026-08-14; three days out is the 17th, late in the evening.
      'user-1': [expiringItem('item-1', 'spinach', '2026-08-17T22:00:00')],
    });

    const summary = await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(summary.usersAlerted).toBe(1);
  });

  it('leaves food beyond the window alone', async () => {
    const db = makeDb([alertingUser()], {
      'user-1': [expiringItem('item-1', 'rice', '2026-09-30T12:00:00')],
    });

    const summary = await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(summary.usersAlerted).toBe(0);
  });
});

describe('the schedule', () => {
  it('counts days in the timezone it is scheduled in', () => {
    // Not UTC. The function runs in UTC, so at the 9 AM New York firing an
    // item stamped for 23:00 that evening is already the next UTC day — the
    // text said "tomorrow" beside a card correctly reading "Expires today".
    expect(ALERT_TIME_ZONE).toBe('America/New_York');

    // Reading the built trigger needs a GCLOUD_PROJECT these tests do not
    // have, so this checks the thing that actually drifts: the schedule must
    // take the same constant the day arithmetic counts in, never its own
    // hardcoded copy.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../sendDailyWasteAlerts.js'),
      'utf8'
    );
    expect(source).toMatch(/\.timeZone\(ALERT_TIME_ZONE\)/);
  });

  it('names the notification for the cook’s day, not the server’s', () => {
    // 01:30 UTC on the 15th is still 21:30 on the 14th in New York.
    expect(isoDay(new Date('2026-08-15T01:30:00Z'))).toBe('2026-08-14');
    expect(isoDay(new Date('2026-08-14T13:00:00Z'))).toBe('2026-08-14');
  });
});

describe('runDailyWasteAlerts', () => {
  it('writes an in-app notification even with no SMS provider configured', async () => {
    const db = makeDb([alertingUser()], {
      'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')],
    });
    const send = mockSender();

    const summary = await runDailyWasteAlerts({ db, now: NOW, send, env: {} });

    expect(summary).toMatchObject({ usersAlerted: 1, notificationsWritten: 1, smsSent: 0 });
    const notification = notificationFor('user-1');
    expect(notification.data).toMatchObject({
      type: NOTIFICATION_TYPE,
      read: false,
      channel: 'in-app',
      itemIds: ['item-1'],
      itemCount: 1,
    });
    expect(notification.data.body).toContain('spinach');
    // The cook did not ask for texts, so none was attempted.
    expect(send).not.toHaveBeenCalled();
  });

  it('uses a date-derived id so a re-run updates rather than duplicates', async () => {
    const db = makeDb([alertingUser()], {
      'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')],
    });

    await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(notificationFor('user-1').path).toBe(
      'users/user-1/notifications/waste-alert-2026-08-14'
    );
  });

  it('texts the cooks who asked for texts', async () => {
    const db = makeDb(
      [alertingUser('user-1', { smsAlerts: { enabled: true, phoneNumber: '+15551234567' } })],
      { 'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')] }
    );
    const send = mockSender();

    const summary = await runDailyWasteAlerts({ db, now: NOW, send, env: {} });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('+15551234567');
    expect(send.mock.calls[0][1]).toContain('spinach');
    expect(summary.smsSent).toBe(1);
    expect(notificationFor('user-1').data.channel).toBe('sms');
  });

  it('records why a text did not go out, and still writes the in-app alert', async () => {
    const db = makeDb(
      [alertingUser('user-1', { smsAlerts: { enabled: true, phoneNumber: '+15551234567' } })],
      { 'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')] }
    );
    const send = mockSender({ sent: false, skipped: true, reason: 'not-configured' });

    const summary = await runDailyWasteAlerts({ db, now: NOW, send, env: {} });

    expect(summary).toMatchObject({ smsSent: 0, smsSkipped: 1, notificationsWritten: 1 });
    expect(notificationFor('user-1').data).toMatchObject({
      channel: 'in-app',
      smsStatus: 'not-configured',
    });
  });

  it('leaves alone the cooks who have nothing expiring', async () => {
    const db = makeDb([alertingUser()], { 'user-1': [] });

    const summary = await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(summary).toMatchObject({ usersChecked: 1, usersAlerted: 0, notificationsWritten: 0 });
    expect(writes).toEqual([]);
  });

  it('respects a cook who has turned every alert off', async () => {
    const db = makeDb(
      [
        user('user-1', {
          notifications: { expiringSoon: false },
          smsAlerts: { enabled: false },
        }),
      ],
      { 'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')] }
    );

    const summary = await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(summary.usersAlerted).toBe(0);
    expect(writes).toEqual([]);
  });

  it('ignores items that have been used up', async () => {
    const db = makeDb([alertingUser()], {
      'user-1': [
        { ...expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z'), quantity: 0 },
        expiringItem('item-2', 'milk', '2026-08-15T09:00:00Z'),
      ],
    });

    await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(notificationFor('user-1').data.itemIds).toEqual(['item-2']);
  });

  it('ignores items with no expiry date at all', async () => {
    const db = makeDb([alertingUser()], {
      'user-1': [{ id: 'item-1', name: 'salt', quantity: 1, expiresAt: null }],
    });

    const summary = await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(summary.usersAlerted).toBe(0);
  });

  it('keeps going when one account is broken', async () => {
    const db = makeDb([alertingUser('user-1'), alertingUser('user-2')], {
      'user-2': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')],
    });

    // Poison the first user's inventory read.
    const original = db.collection;
    db.collection = (name) => {
      const ref = original(name);
      return {
        ...ref,
        doc: (uid) =>
          uid === 'user-1'
            ? {
                collection: () => ({
                  where: () => {
                    throw new Error('index missing');
                  },
                }),
              }
            : ref.doc(uid),
      };
    };

    const summary = await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(summary.errors).toBe(1);
    expect(summary.notificationsWritten).toBe(1);
    expect(notificationFor('user-2')).toBeDefined();
  });

  it('alerts every cook who needs one', async () => {
    const db = makeDb([alertingUser('user-1'), alertingUser('user-2')], {
      'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')],
      'user-2': [expiringItem('item-2', 'milk', '2026-08-15T09:00:00Z')],
    });

    const summary = await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(summary).toMatchObject({ usersChecked: 2, usersAlerted: 2, notificationsWritten: 2 });
  });

  it('still writes the in-app alert when the SMS sender throws', async () => {
    // `sendSms` is written never to throw, but if it ever does the failure
    // used to reach the per-user handler, which counted an error and moved on
    // — costing this cook the channel that exists precisely for when texting
    // does not work.
    const db = makeDb(
      [alertingUser('user-1', { smsAlerts: { enabled: true, phoneNumber: '+15551234567' } })],
      { 'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')] }
    );
    const send = jest.fn(async () => {
      throw new Error('provider adapter blew up');
    });

    const summary = await runDailyWasteAlerts({ db, now: NOW, send, env: {} });

    expect(summary).toMatchObject({ errors: 0, notificationsWritten: 1, smsSkipped: 1 });
    expect(notificationFor('user-1').data).toMatchObject({
      channel: 'in-app',
      smsStatus: 'sender-threw',
    });
  });

  it('survives an SMS client that resolves with nothing at all', async () => {
    const db = makeDb(
      [alertingUser('user-1', { smsAlerts: { enabled: true, phoneNumber: '+15551234567' } })],
      { 'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')] }
    );

    const summary = await runDailyWasteAlerts({
      db,
      now: NOW,
      send: jest.fn(async () => undefined),
      env: {},
    });

    expect(summary).toMatchObject({ errors: 0, notificationsWritten: 1 });
    expect(notificationFor('user-1').data.channel).toBe('in-app');
  });

  it('reaches food expiring late on the last day of the window', async () => {
    // The cutoff used to be "now plus N × 24 hours", so at a 9 AM run an item
    // going off at 6 PM three days out fell outside the query — while
    // `describeTiming`, which counts calendar days, would happily have called
    // it "in 3 days".
    const db = makeDb([alertingUser()], {
      'user-1': [expiringItem('item-1', 'spinach', '2026-08-17T22:00:00Z')],
    });

    const summary = await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(summary.usersAlerted).toBe(1);
  });

  it('stamps the notification with the run time it was given', async () => {
    const db = makeDb([alertingUser()], {
      'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')],
    });

    await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(notificationFor('user-1').data.createdAt).toBe(NOW.toISOString());
  });
});
