// Covers the inventory hook: the pure expiration helpers (which drive every
// colour-coded badge in the UI) and the Firestore-backed CRUD surface.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useInventory, {
  EXPIRATION_LEVELS,
  SHELF_LIFE_DEFAULTS,
  byExpirySoonestFirst,
  calcExpiresAt,
  getDaysUntilExpiration,
  getExpirationBadgeStyle,
  getExpirationLabel,
  getExpirationLevel,
  getExpirationStatus,
  hasExplicitShelfLife,
  isCustomShelfLife,
  resolveShelfLifeDays,
} from '../useInventory';
import { buildInventoryDoc } from '../useCSVImport';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeItem, daysFromNow, makeUserProfile } from '../../test-utils/factories';
import { expectHumanError } from '../../test-utils/humanErrors';

const UID = 'test-uid';
const INVENTORY_PATH = `users/${UID}/inventory`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

/** Render the hook signed in, with the first snapshot already delivered. */
const renderInventory = async (items = []) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useInventory(), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(INVENTORY_PATH, asDocs(items));
  });
  return view;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('getExpirationStatus', () => {
  it.each([
    ['expired', -1],
    ['expired', -30],
    ['critical', 0],
    ['critical', 2],
    ['warning', 3],
    ['warning', 5],
    ['safe', 6],
    ['safe', 400],
  ])('returns %s for an item expiring in %i days', (expected, days) => {
    expect(getExpirationStatus(daysFromNow(days))).toBe(expected);
  });

  it('treats a missing expiry as safe rather than throwing', () => {
    expect(getExpirationStatus(null)).toBe('safe');
    expect(getExpirationStatus(undefined)).toBe('safe');
  });

  it('accepts a plain Date as well as a Firestore Timestamp', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(getExpirationStatus(tomorrow)).toBe('critical');
  });
});

describe('getExpirationLabel', () => {
  it('counts days since expiry for expired items', () => {
    expect(getExpirationLabel(daysFromNow(-3))).toMatch(/Expired 3d ago/);
  });

  it('special-cases today and tomorrow', () => {
    expect(getExpirationLabel(daysFromNow(0))).toBe('Expires today');
    expect(getExpirationLabel(daysFromNow(1))).toBe('Expires tomorrow');
  });

  it('counts forward within a month', () => {
    expect(getExpirationLabel(daysFromNow(12))).toBe('Expires in 12d');
  });

  it('switches to a calendar date beyond a month', () => {
    expect(getExpirationLabel(daysFromNow(90))).not.toMatch(/Expires in/);
  });

  it('says so when there is no expiry', () => {
    expect(getExpirationLabel(null)).toBe('No expiry');
  });
});

// ---------------------------------------------------------------------------
// Day boundaries
//
// Expiry is a date, not a moment: a carton stamped for today is "today" all
// day. These are the cases the original rolling-24-hour arithmetic got wrong,
// and the ones a refactor is most likely to break again.
// ---------------------------------------------------------------------------

describe('expiry day boundaries', () => {
  /** A local wall-clock Date, so assertions do not depend on the suite's TZ. */
  const at = (year, month, day, hour = 0, minute = 0) =>
    new Date(year, month - 1, day, hour, minute, 0, 0);

  const withClock = (now, assertions) => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    try {
      assertions();
    } finally {
      jest.useRealTimers();
    }
  };

  it('still says "today" at one minute to midnight', () => {
    withClock(at(2026, 8, 15, 10, 0), () => {
      const tonight = at(2026, 8, 15, 23, 59);
      expect(getDaysUntilExpiration(tonight)).toBe(0);
      expect(getExpirationLabel(tonight)).toBe('Expires today');
      expect(getExpirationStatus(tonight)).toBe('critical');
    });
  });

  it('calls yesterday evening expired, not "today"', () => {
    // Rolling-24h arithmetic rounded this to 0 and rendered "Expires today"
    // for food whose date had already passed.
    withClock(at(2026, 8, 15, 10, 0), () => {
      const lastNight = at(2026, 8, 14, 23, 0);
      expect(getDaysUntilExpiration(lastNight)).toBe(-1);
      expect(getExpirationLabel(lastNight)).toBe('Expired 1d ago');
      expect(getExpirationStatus(lastNight)).toBe('expired');
    });
  });

  it('calls tomorrow "tomorrow" whatever time of day either falls at', () => {
    withClock(at(2026, 8, 15, 1, 0), () => {
      // 46 hours away, but the next calendar day.
      expect(getExpirationLabel(at(2026, 8, 16, 23, 0))).toBe('Expires tomorrow');
    });
  });

  it('gives the same answer whatever time the page is open', () => {
    const expiry = at(2026, 8, 18, 15, 0);
    const answers = [0, 6, 12, 18, 23].map((hour) => {
      let days;
      withClock(at(2026, 8, 15, hour, 30), () => {
        days = getDaysUntilExpiration(expiry);
      });
      return days;
    });

    expect(answers).toEqual([3, 3, 3, 3, 3]);
  });

  it('counts a spring-forward day as one day', () => {
    // 2026-03-08 is the US spring-forward: 23 hours long. Counting elapsed
    // milliseconds would make "tomorrow" land 0.96 days out.
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      withClock(at(2026, 3, 7, 20, 0), () => {
        expect(getDaysUntilExpiration(at(2026, 3, 8, 20, 0))).toBe(1);
        expect(getExpirationLabel(at(2026, 3, 8, 20, 0))).toBe('Expires tomorrow');
      });
      withClock(at(2026, 3, 8, 20, 0), () => {
        expect(getDaysUntilExpiration(at(2026, 3, 9, 20, 0))).toBe(1);
      });
    } finally {
      process.env.TZ = original;
    }
  });

  it('counts a fall-back day as one day', () => {
    // 2026-11-01 is 25 hours long in New York.
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      withClock(at(2026, 10, 31, 20, 0), () => {
        expect(getDaysUntilExpiration(at(2026, 11, 1, 20, 0))).toBe(1);
      });
    } finally {
      process.env.TZ = original;
    }
  });

  it('reads an expiry stamped in another timezone against the reader"s calendar', () => {
    // The item was added at 22:00 in Sydney; the cook reading it is in New
    // York, where that instant is still the previous morning.
    const stampedInSydney = new Date('2026-08-16T12:00:00Z'); // 22:00 AEST, 08:00 EDT
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      withClock(new Date('2026-08-16T13:00:00Z'), () => {
        expect(getDaysUntilExpiration(stampedInSydney)).toBe(0);
        expect(getExpirationLabel(stampedInSydney)).toBe('Expires today');
      });
    } finally {
      process.env.TZ = original;
    }
  });

  it('agrees with the wording the daily alert function uses', () => {
    // A transcription of daysUntil() from
    // functions/src/wasteAlerts/alertMessage.js, which has always counted
    // calendar days. The app used to count rolling hours, so a notification
    // could read "spinach (today)" beside a card reading "Expires tomorrow".
    const asTheAlertCountsIt = (expiry, now) => {
      const midnight = (d) => {
        const c = new Date(d);
        c.setHours(0, 0, 0, 0);
        return c;
      };
      return Math.round((midnight(expiry) - midnight(now)) / 86400000);
    };

    const now = at(2026, 8, 15, 9, 0);
    withClock(now, () => {
      [at(2026, 8, 15, 22, 0), at(2026, 8, 17, 6, 0), at(2026, 8, 14, 23, 30)].forEach((expiry) => {
        expect(getDaysUntilExpiration(expiry)).toBe(asTheAlertCountsIt(expiry, now));
      });
    });
  });
});

describe('calcExpiresAt', () => {
  it('uses the per-location default when no shelf life is given', () => {
    const expires = calcExpiresAt('fridge');
    const days = Math.round((expires - new Date()) / 86400000);
    expect(days).toBe(SHELF_LIFE_DEFAULTS.fridge);
  });

  it('prefers an explicit shelf life over the default', () => {
    const expires = calcExpiresAt('fridge', 45);
    const days = Math.round((expires - new Date()) / 86400000);
    expect(days).toBe(45);
  });

  it('falls back to 30 days for an unknown location type', () => {
    const expires = calcExpiresAt('spaceship');
    const days = Math.round((expires - new Date()) / 86400000);
    expect(days).toBe(30);
  });

  it('gives the freezer a much longer default than the fridge', () => {
    expect(SHELF_LIFE_DEFAULTS.freezer).toBeGreaterThan(SHELF_LIFE_DEFAULTS.fridge);
    expect(SHELF_LIFE_DEFAULTS.pantry).toBeGreaterThan(SHELF_LIFE_DEFAULTS.fridge);
  });
});

describe('resolveShelfLifeDays', () => {
  it('prefers the per-ingredient number over the blanket location default', () => {
    // Chicken lasts two days in the fridge; a blanket "fridge = 7" would be
    // dangerously wrong for it and needlessly short for a block of cheese.
    expect(resolveShelfLifeDays('chicken breast', 'fridge')).toBe(2);
    expect(resolveShelfLifeDays('cheese', 'fridge')).toBe(21);
  });

  it('is case- and whitespace-insensitive, like the names people type', () => {
    expect(resolveShelfLifeDays('  Chicken Breast  ', 'fridge')).toBe(2);
  });

  it('falls back to the location default for an unknown ingredient', () => {
    expect(resolveShelfLifeDays('Dragonfruit Curd', 'freezer')).toBe(SHELF_LIFE_DEFAULTS.freezer);
    expect(resolveShelfLifeDays('Dragonfruit Curd', 'fridge')).toBe(SHELF_LIFE_DEFAULTS.fridge);
  });

  it('still dates an item the table says does not belong where it is', () => {
    // Milk in the pantry is a bad idea, but it is in there and needs an expiry.
    expect(resolveShelfLifeDays('milk', 'pantry')).toBe(SHELF_LIFE_DEFAULTS.pantry);
  });

  it('always gives the freezer at least as long as the fridge', () => {
    ['milk', 'chicken breast', 'spinach', 'bread', 'Dragonfruit Curd'].forEach((name) => {
      expect(resolveShelfLifeDays(name, 'freezer')).toBeGreaterThanOrEqual(
        resolveShelfLifeDays(name, 'fridge')
      );
    });
  });
});

describe('hasExplicitShelfLife', () => {
  it.each([
    [undefined, false],
    [null, false],
    ['', false],
    ['not a number', false],
    [0, true],
    [45, true],
    ['45', true],
  ])('treats %p as explicit: %p', (value, expected) => {
    expect(hasExplicitShelfLife(value)).toBe(expected);
  });
});

describe('isCustomShelfLife', () => {
  it('trusts the recorded source when there is one', () => {
    expect(isCustomShelfLife(makeItem({ shelfLifeSource: 'custom', shelfLifeDays: 7 }))).toBe(true);
    expect(isCustomShelfLife(makeItem({ shelfLifeSource: 'default', shelfLifeDays: 99 }))).toBe(
      false
    );
  });

  it('infers it for older documents by comparing against the lookup', () => {
    const asStored = (overrides) => makeItem({ shelfLifeSource: undefined, ...overrides });

    expect(
      isCustomShelfLife(asStored({ name: 'Milk', locationType: 'fridge', shelfLifeDays: 7 }))
    ).toBe(false);
    expect(
      isCustomShelfLife(asStored({ name: 'Milk', locationType: 'fridge', shelfLifeDays: 21 }))
    ).toBe(true);
  });

  it('says no for an item with no shelf life at all', () => {
    expect(isCustomShelfLife(makeItem({ shelfLifeSource: undefined, shelfLifeDays: null }))).toBe(
      false
    );
    expect(isCustomShelfLife(null)).toBe(false);
  });
});

describe('expiration colour-coding', () => {
  it.each([
    ['Expired', -1],
    ['Critical', 1],
    ['Soon', 4],
    ['Fresh', 60],
  ])('labels an item expiring in %2$i days as %1$s', (label, days) => {
    expect(getExpirationLevel(daysFromNow(days)).label).toBe(label);
  });

  it('gives every level a css class the stylesheet defines', () => {
    Object.values(EXPIRATION_LEVELS).forEach((level) => {
      expect(level.cardClass).toMatch(/^expiration-(critical|warning|safe)$/);
      expect(level.background).toMatch(/^var\(--mkh-/);
      expect(level.foreground).toMatch(/^var\(--mkh-/);
    });
  });

  it('only tells the cook to act on the two urgent levels', () => {
    expect(EXPIRATION_LEVELS.expired.warning).toBeTruthy();
    expect(EXPIRATION_LEVELS.critical.warning).toBeTruthy();
    expect(EXPIRATION_LEVELS.safe.warning).toBeNull();
  });

  it('ranks the levels most urgent first', () => {
    const ranks = ['expired', 'critical', 'warning', 'safe'].map((k) => EXPIRATION_LEVELS[k].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('builds a badge style from the level tokens', () => {
    const style = getExpirationBadgeStyle(daysFromNow(-1));
    expect(style.background).toBe(EXPIRATION_LEVELS.expired.background);
    expect(style.border).toContain(EXPIRATION_LEVELS.expired.foreground);
  });

  it('falls back to fresh rather than crashing on a missing expiry', () => {
    expect(getExpirationLevel(null).label).toBe('Fresh');
  });
});

describe('getDaysUntilExpiration', () => {
  it('counts forward and backward', () => {
    expect(getDaysUntilExpiration(daysFromNow(3))).toBe(3);
    expect(getDaysUntilExpiration(daysFromNow(-2))).toBe(-2);
  });

  it('returns null for a missing or unparseable date', () => {
    expect(getDaysUntilExpiration(null)).toBeNull();
    expect(getDaysUntilExpiration('not a date')).toBeNull();
  });
});

describe('byExpirySoonestFirst', () => {
  it('puts the most urgent item first and undated ones last', () => {
    const sorted = [
      makeItem({ name: 'Later', expiresAt: daysFromNow(9) }),
      makeItem({ name: 'Undated', expiresAt: null }),
      makeItem({ name: 'Sooner', expiresAt: daysFromNow(1) }),
    ].sort(byExpirySoonestFirst);

    expect(sorted.map((i) => i.name)).toEqual(['Sooner', 'Later', 'Undated']);
  });
});

// ---------------------------------------------------------------------------
// Hook behaviour
// ---------------------------------------------------------------------------

describe('useInventory subscription', () => {
  it("subscribes to the signed-in user's inventory and exposes the documents", async () => {
    const { result } = await renderInventory([
      makeItem({ id: 'a', name: 'Milk' }),
      makeItem({ id: 'b', name: 'Eggs' }),
    ]);

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.map((i) => i.name)).toEqual(['Milk', 'Eggs']);
    expect(result.current.items[0].id).toBe('a');
    expect(result.current.loading).toBe(false);
  });

  it('orders the query by name so the list is stable', async () => {
    await renderInventory([]);
    expect(fs.orderBy).toHaveBeenCalledWith('name', 'asc');
  });

  it('does not subscribe when signed out, and reports an empty inventory', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useInventory(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  it('surfaces a listener failure as an error message instead of hanging', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderInventory([]);

    await act(async () => {
      fs.__emitError(INVENTORY_PATH, new Error('permission-denied'));
    });

    expectHumanError(result.current.error, /kitchen/i);
    expect(result.current.loading).toBe(false);
  });

  it('unsubscribes on unmount so a signed-out user keeps no listener', async () => {
    const { unmount } = await renderInventory([]);
    expect(fs.__listenerCount(INVENTORY_PATH)).toBe(1);

    unmount();
    expect(fs.__listenerCount(INVENTORY_PATH)).toBe(0);
  });
});

describe('useInventory.addItem', () => {
  const validItem = {
    name: '  Milk  ',
    quantity: 2,
    unit: 'gal',
    locationId: 'loc-fridge',
    locationType: 'fridge',
  };

  it("writes a normalized document to the user's inventory collection", async () => {
    const { result } = await renderInventory([]);

    let response;
    await act(async () => {
      response = await result.current.addItem(validItem);
    });

    expect(response).toEqual({ success: true });
    expect(fs.addDoc).toHaveBeenCalledTimes(1);

    const [ref, payload] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(INVENTORY_PATH);
    expect(payload.name).toBe('Milk');
    expect(payload.normalized).toBe('milk');
    expect(payload.quantity).toBe(2);
    expect(payload.shelfLifeDays).toBe(SHELF_LIFE_DEFAULTS.fridge);
    expect(payload.source).toBe('manual');
    expect(payload.totalTimesPurchased).toBe(1);
  });

  it('dates a new item from the ingredient, not just the location', async () => {
    const { result } = await renderInventory([]);

    await act(async () => {
      await result.current.addItem({ ...validItem, name: 'Chicken Breast' });
    });

    const [, payload] = fs.addDoc.mock.calls[0];
    expect(payload.shelfLifeDays).toBe(resolveShelfLifeDays('Chicken Breast', 'fridge'));
    expect(payload.shelfLifeSource).toBe('default');
  });

  it('records a shelf life the cook typed as theirs', async () => {
    const { result } = await renderInventory([]);

    await act(async () => {
      await result.current.addItem({ ...validItem, shelfLifeDays: 21 });
    });

    const [, payload] = fs.addDoc.mock.calls[0];
    expect(payload.shelfLifeDays).toBe(21);
    expect(payload.shelfLifeSource).toBe('custom');
  });

  it('seeds purchase history so shopping analytics has data from day one', async () => {
    const { result } = await renderInventory([]);

    await act(async () => {
      await result.current.addItem({ ...validItem, price: '4.99', store: 'Aldi' });
    });

    const [, payload] = fs.addDoc.mock.calls[0];
    expect(payload.purchaseHistory).toHaveLength(1);
    expect(payload.purchaseHistory[0]).toMatchObject({ quantity: 2, price: 4.99, store: 'Aldi' });
  });

  it.each([
    ['a blank name', { name: '   ' }, /Name is required/],
    ['zero quantity', { quantity: 0 }, /greater than 0/],
    ['a negative quantity', { quantity: -1 }, /greater than 0/],
    ['no location', { locationId: '' }, /select a storage location/],
    ['an invalid location type', { locationType: 'garage' }, /Invalid location type/],
  ])('rejects %s without writing', async (_label, patch, message) => {
    const { result } = await renderInventory([]);

    let response;
    await act(async () => {
      response = await result.current.addItem({ ...validItem, ...patch });
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(message);
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('refuses to write when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useInventory(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.addItem(validItem);
    });

    expect(response).toEqual({ success: false, error: 'Not authenticated' });
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('reports the failure rather than throwing when Firestore rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderInventory([]);
    fs.addDoc.mockRejectedValueOnce(new Error('quota exceeded'));

    let response;
    await act(async () => {
      response = await result.current.addItem(validItem);
    });

    expect(response.success).toBe(false);
    expectHumanError(response.error, /add that item/i);
  });
});

describe('useInventory.updateItem', () => {
  it('patches the document and stamps updatedAt', async () => {
    const { result } = await renderInventory([makeItem({ id: 'item-1', name: 'Milk' })]);

    await act(async () => {
      await result.current.updateItem('item-1', { quantity: 5 });
    });

    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`${INVENTORY_PATH}/item-1`);
    expect(patch.quantity).toBe(5);
    expect(patch.updatedAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('recalculates the expiry when the shelf life is changed explicitly', async () => {
    const { result } = await renderInventory([
      makeItem({ id: 'item-1', locationType: 'fridge', shelfLifeDays: 7 }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { shelfLifeDays: 45 });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(45);
  });

  // Moving something to the freezer has to extend how long it keeps — that is
  // the entire reason a person freezes food. `shelfLifeSource` is what makes it
  // possible: a shelf life we defaulted is ours to recalculate.
  it('extends the shelf life when an item is moved to the freezer', async () => {
    const { result } = await renderInventory([
      makeItem({ id: 'item-1', name: 'Milk', locationType: 'fridge', shelfLifeDays: 7 }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { locationType: 'freezer' });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);

    // Milk keeps 90 days frozen against 7 in the fridge, per the shelf-life table.
    expect(days).toBe(resolveShelfLifeDays('Milk', 'freezer'));
    expect(days).toBeGreaterThan(7);
    expect(patch.shelfLifeDays).toBe(days);
    expect(patch.shelfLifeSource).toBe('default');
  });

  it('falls back to the location default for an ingredient it has never heard of', async () => {
    const { result } = await renderInventory([
      makeItem({
        id: 'item-1',
        name: 'Dragonfruit Curd',
        locationType: 'fridge',
        shelfLifeDays: 7,
      }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { locationType: 'freezer' });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(SHELF_LIFE_DEFAULTS.freezer);
  });

  it('leaves a shelf life the cook chose alone when the item moves', async () => {
    const { result } = await renderInventory([
      makeItem({
        id: 'item-1',
        name: 'Milk',
        locationType: 'fridge',
        shelfLifeDays: 3,
        shelfLifeSource: 'custom',
      }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { locationType: 'freezer' });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(3);
    expect(patch).not.toHaveProperty('shelfLifeDays');
  });

  it('treats an old document with no shelfLifeSource as defaulted when it matches the table', async () => {
    // Items written before the field existed still have to gain freezer time.
    const { result } = await renderInventory([
      makeItem({
        id: 'item-1',
        name: 'Milk',
        locationType: 'fridge',
        shelfLifeDays: 7,
        shelfLifeSource: undefined,
      }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { locationType: 'freezer' });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(resolveShelfLifeDays('Milk', 'freezer'));
  });

  it('treats an old document with an off-table shelf life as the cook’s own', async () => {
    const { result } = await renderInventory([
      makeItem({
        id: 'item-1',
        name: 'Milk',
        locationType: 'fridge',
        shelfLifeDays: 21,
        shelfLifeSource: undefined,
      }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { locationType: 'freezer' });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(21);
  });

  it('recalculates the expiry when a rename lands on a different ingredient', async () => {
    const { result } = await renderInventory([
      makeItem({ id: 'item-1', name: 'Milk', locationType: 'pantry', shelfLifeDays: 90 }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { name: 'Rice' });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(resolveShelfLifeDays('Rice', 'pantry'));
  });

  it('does not recalculate when the location is re-sent unchanged', async () => {
    const { result } = await renderInventory([
      makeItem({ id: 'item-1', name: 'Milk', locationType: 'fridge', shelfLifeDays: 7 }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { locationType: 'fridge', quantity: 2 });
    });

    expect(fs.updateDoc.mock.calls[0][1]).not.toHaveProperty('expiresAt');
  });

  it('does not rewrite an imported item’s expiry when it is renamed', async () => {
    // The harm shelfLifeSource exists to prevent, end to end. A CSV row that
    // said "milk keeps 7 days" produced a document indistinguishable from one
    // we had guessed at, because 7 is also what the table says — so this
    // rename recalculated the expiry and threw the cook's date away.
    const imported = buildInventoryDoc({
      name: 'Milk',
      normalized: 'milk',
      quantity: 1,
      unit: 'gal',
      locationId: 'loc-fridge',
      locationType: 'fridge',
      shelfLifeDays: 7,
      expiresAt: null,
      notes: '',
    });

    const { result } = await renderInventory([
      makeItem({ id: 'item-1', ...imported, expiresAt: daysFromNow(7) }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { name: 'Whole Milk' });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    expect(patch).not.toHaveProperty('shelfLifeDays');
    expect(patch).not.toHaveProperty('shelfLifeSource');
  });

  it('does not invent an expiry for an item it has no copy of', async () => {
    // Nothing to compare against means everything looks changed, so the shelf
    // life was recalculated from an undefined location and landed on the
    // 30-day last resort — quietly replacing whatever the item really had.
    const { result } = await renderInventory([makeItem({ id: 'item-1' })]);

    await act(async () => {
      await result.current.updateItem('not-in-the-snapshot', { name: 'Milk', quantity: 2 });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    expect(patch).not.toHaveProperty('expiresAt');
    expect(patch).not.toHaveProperty('shelfLifeDays');
    expect(patch.quantity).toBe(2);
  });

  it('still honours an explicit shelf life for an item it has no copy of', async () => {
    const { result } = await renderInventory([makeItem({ id: 'item-1' })]);

    await act(async () => {
      await result.current.updateItem('not-in-the-snapshot', { shelfLifeDays: 14 });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    expect(patch.shelfLifeDays).toBe(14);
    expect(patch.shelfLifeSource).toBe('custom');
  });

  it('leaves the expiry alone for edits that do not affect shelf life', async () => {
    const { result } = await renderInventory([makeItem({ id: 'item-1' })]);

    await act(async () => {
      await result.current.updateItem('item-1', { notes: 'open' });
    });

    expect(fs.updateDoc.mock.calls[0][1]).not.toHaveProperty('expiresAt');
  });

  it('refuses to write when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useInventory(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.updateItem('item-1', { quantity: 2 });
    });

    expect(response).toEqual({ success: false, error: 'Not authenticated' });
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });
});

describe('useInventory.getExpiringItems', () => {
  it('returns only what expires inside the window, most urgent first', async () => {
    const { result } = await renderInventory([
      makeItem({ id: 'a', name: 'Rice', expiresAt: daysFromNow(90) }),
      makeItem({ id: 'b', name: 'Yogurt', expiresAt: daysFromNow(-2) }),
      makeItem({ id: 'c', name: 'Spinach', expiresAt: daysFromNow(3) }),
      makeItem({ id: 'd', name: 'Salt', expiresAt: null }),
    ]);

    const expiring = result.current.getExpiringItems(5);
    expect(expiring.map((i) => i.name)).toEqual(['Yogurt', 'Spinach']);
  });
});

describe('useInventory.deleteItem', () => {
  it('deletes the addressed document', async () => {
    const { result } = await renderInventory([makeItem({ id: 'item-1' })]);

    let response;
    await act(async () => {
      response = await result.current.deleteItem('item-1');
    });

    expect(response.success).toBe(true);
    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe(`${INVENTORY_PATH}/item-1`);
  });

  it('reports the failure rather than throwing when Firestore rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderInventory([makeItem({ id: 'item-1' })]);
    fs.deleteDoc.mockRejectedValueOnce(new Error('offline'));

    let response;
    await act(async () => {
      response = await result.current.deleteItem('item-1');
    });

    expect(response.success).toBe(false);
    expectHumanError(response.error, /remove that item/i);
  });
});
