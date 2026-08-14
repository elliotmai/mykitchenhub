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

/** A chainable Firestore fake that records every set() by path. */
const makeDb = (users = [], inventoryByUser = {}) => {
  inventories = inventoryByUser;

  const docSnapshot = (id, data) => ({ id, data: () => data, exists: true });

  const inventoryQuery = (uid) => {
    const chain = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      get: async () => {
        const items = inventories[uid] ?? [];
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

const { runDailyWasteAlerts, wantsWasteAlerts, NOTIFICATION_TYPE } = require('../sendDailyWasteAlerts');

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

  it('stamps the notification with the run time it was given', async () => {
    const db = makeDb([alertingUser()], {
      'user-1': [expiringItem('item-1', 'spinach', '2026-08-14T18:00:00Z')],
    });

    await runDailyWasteAlerts({ db, now: NOW, send: mockSender(), env: {} });

    expect(notificationFor('user-1').data.createdAt).toBe(NOW.toISOString());
  });
});
