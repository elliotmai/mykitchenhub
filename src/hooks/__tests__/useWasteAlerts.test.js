// The hook behind the waste alerts page: which food is at risk, which of it
// the freezer would save, and what happens when the cook taps "Freeze".

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useWasteAlerts, { canSplitQuantity, getFreezerBenefit, halfOf } from '../useWasteAlerts';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import {
  asDocs,
  makeItem,
  makeLocation,
  daysFromNow,
  makeUserProfile,
} from '../../test-utils/factories';

const UID = 'test-uid';
const INVENTORY_PATH = `users/${UID}/inventory`;
const LOCATIONS_PATH = `users/${UID}/storageLocations`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const FREEZER = makeLocation({
  id: 'loc-freezer',
  label: 'Freezer',
  type: 'freezer',
  icon: '❄️',
  isDefault: true,
});
const FRIDGE = makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' });

/** Render signed in, with inventory and locations already delivered. */
const renderAlerts = async (items = [], locations = [FRIDGE, FREEZER], options) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useWasteAlerts(options), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(INVENTORY_PATH, asDocs(items));
    fs.__emit(LOCATIONS_PATH, asDocs(locations));
  });
  return view;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('getFreezerBenefit', () => {
  it('works out how many days freezing would buy', () => {
    const benefit = getFreezerBenefit(
      makeItem({ name: 'Milk', locationType: 'fridge', expiresAt: daysFromNow(2) })
    );

    // Milk keeps 90 days frozen and has 2 left where it is.
    expect(benefit).toMatchObject({ frozenDays: 90, daysLeft: 2, daysGained: 88 });
  });

  it('refuses to suggest freezing something already in the freezer', () => {
    expect(
      getFreezerBenefit(
        makeItem({ name: 'Peas', locationType: 'freezer', expiresAt: daysFromNow(2) })
      )
    ).toBeNull();
  });

  it('refuses to suggest freezing food the table says does not freeze', () => {
    // Lettuce comes out of the freezer as slime; the table records that as null.
    expect(
      getFreezerBenefit(
        makeItem({ name: 'Lettuce', locationType: 'fridge', expiresAt: daysFromNow(1) })
      )
    ).toBeNull();
  });

  it('stays quiet when the gain is not worth a tap', () => {
    const benefit = getFreezerBenefit(
      makeItem({ name: 'Bread', locationType: 'pantry', expiresAt: daysFromNow(88) })
    );
    expect(benefit).toBeNull();
  });

  it('does not offer to rescue food that has already gone off', () => {
    // This used to return a benefit of the full frozen shelf life, because an
    // expired item was counted as having "0 days left" — which made it the
    // biggest gain on the page and sorted it to the top. Freezing preserves
    // food; it cannot un-expire it.
    expect(
      getFreezerBenefit(
        makeItem({ name: 'Milk', locationType: 'fridge', expiresAt: daysFromNow(-3) })
      )
    ).toBeNull();
  });

  it('says nothing about an item with no expiry date at all', () => {
    expect(
      getFreezerBenefit(makeItem({ name: 'Milk', locationType: 'fridge', expiresAt: null }))
    ).toBeNull();
  });

  it('quotes the shelf life the cook chose, not the one the table would pick', () => {
    // updateItem carries a custom shelf life across a move rather than
    // overwriting it, so a badge quoting milk's 90 frozen days promised 88
    // days that freezing would never deliver.
    const benefit = getFreezerBenefit(
      makeItem({
        name: 'Milk',
        locationType: 'fridge',
        expiresAt: daysFromNow(2),
        shelfLifeDays: 30,
        shelfLifeSource: 'custom',
      })
    );

    expect(benefit).toMatchObject({ frozenDays: 30, daysLeft: 2, daysGained: 28 });
  });

  it('stays quiet when the cook’s own shelf life leaves nothing to gain', () => {
    expect(
      getFreezerBenefit(
        makeItem({
          name: 'Milk',
          locationType: 'fridge',
          expiresAt: daysFromNow(2),
          shelfLifeDays: 3,
          shelfLifeSource: 'custom',
        })
      )
    ).toBeNull();
  });
});

describe('canSplitQuantity', () => {
  it.each([
    [4, true],
    [2, true],
    [1.99, false],
    [1, false],
    [0, false],
    ['4', true],
    ['plenty', false],
  ])('says %p can be split: %p', (quantity, expected) => {
    expect(canSplitQuantity(quantity)).toBe(expected);
  });
});

describe('halfOf', () => {
  it.each([
    [4, 2],
    [3, 1.5],
    [2.5, 1.25],
    [1, 0.5],
  ])('halves %p to %p', (input, expected) => {
    expect(halfOf(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Hook behaviour
// ---------------------------------------------------------------------------

describe('useWasteAlerts grouping', () => {
  it('lists everything expiring inside the window, most urgent first', async () => {
    const { result } = await renderAlerts([
      makeItem({ id: 'a', name: 'Rice', expiresAt: daysFromNow(90) }),
      makeItem({ id: 'b', name: 'Spinach', expiresAt: daysFromNow(4) }),
      makeItem({ id: 'c', name: 'Yogurt', expiresAt: daysFromNow(-1) }),
      makeItem({ id: 'd', name: 'Salmon', expiresAt: daysFromNow(1) }),
    ]);

    expect(result.current.expiringItems.map((i) => i.name)).toEqual([
      'Yogurt',
      'Salmon',
      'Spinach',
    ]);
  });

  it('splits them into the buckets the colour-coding uses', async () => {
    const { result } = await renderAlerts([
      makeItem({ id: 'a', name: 'Yogurt', expiresAt: daysFromNow(-1) }),
      makeItem({ id: 'b', name: 'Salmon', expiresAt: daysFromNow(1) }),
      makeItem({ id: 'c', name: 'Spinach', expiresAt: daysFromNow(4) }),
      makeItem({ id: 'd', name: 'Rice', expiresAt: daysFromNow(90) }),
    ]);

    expect(result.current.counts).toEqual({ expired: 1, critical: 1, warning: 1, total: 3 });
    expect(result.current.buckets.expired.map((i) => i.name)).toEqual(['Yogurt']);
  });

  it('honours a wider window when asked for one', async () => {
    const { result } = await renderAlerts(
      [makeItem({ id: 'a', name: 'Cheese', expiresAt: daysFromNow(12) })],
      [FRIDGE, FREEZER],
      { withinDays: 14 }
    );

    expect(result.current.counts.total).toBe(1);
  });

  it('ignores items with no expiry date at all', async () => {
    const { result } = await renderAlerts([makeItem({ id: 'a', name: 'Salt', expiresAt: null })]);

    expect(result.current.counts.total).toBe(0);
  });
});

describe('useWasteAlerts freezer suggestions', () => {
  it('offers the biggest saving first', async () => {
    const { result } = await renderAlerts([
      // Milk keeps 90 days frozen, spinach 365 — the bigger rescue goes first.
      makeItem({ id: 'a', name: 'Milk', locationType: 'fridge', expiresAt: daysFromNow(2) }),
      makeItem({ id: 'b', name: 'Spinach', locationType: 'fridge', expiresAt: daysFromNow(2) }),
    ]);

    expect(result.current.freezerSuggestions.map((s) => s.item.name)).toEqual(['Spinach', 'Milk']);
  });

  it('picks the default freezer to move things into', async () => {
    const { result } = await renderAlerts(
      [],
      [
        FRIDGE,
        makeLocation({
          id: 'loc-garage',
          label: 'Garage Freezer',
          type: 'freezer',
          isDefault: false,
        }),
        FREEZER,
      ]
    );

    expect(result.current.freezerLocation.id).toBe('loc-freezer');
  });

  it('falls back to any freezer when none is marked default', async () => {
    const { result } = await renderAlerts(
      [],
      [
        FRIDGE,
        makeLocation({
          id: 'loc-garage',
          label: 'Garage Freezer',
          type: 'freezer',
          isDefault: false,
        }),
      ]
    );

    expect(result.current.freezerLocation.id).toBe('loc-garage');
  });
});

describe('useWasteAlerts.freezeAll', () => {
  it('moves the item and lets the hook re-date it', async () => {
    const { result } = await renderAlerts([
      makeItem({ id: 'item-1', name: 'Milk', locationType: 'fridge', expiresAt: daysFromNow(1) }),
    ]);

    await act(async () => {
      await result.current.freezeAll(result.current.expiringItems[0]);
    });

    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`${INVENTORY_PATH}/item-1`);
    expect(patch.locationId).toBe('loc-freezer');
    expect(patch.locationType).toBe('freezer');

    // The point of freezing: a much later expiry than the one it had.
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(90);
  });

  it('explains itself instead of failing when there is no freezer', async () => {
    const { result } = await renderAlerts(
      [makeItem({ id: 'item-1', name: 'Milk', expiresAt: daysFromNow(1) })],
      [FRIDGE]
    );

    let response;
    await act(async () => {
      response = await result.current.freezeAll(result.current.expiringItems[0]);
    });

    expect(response).toEqual({ success: false, error: 'Add a freezer in Settings first.' });
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('says so rather than reporting a success that changed nothing', async () => {
    // `updateItem` sees no move when the location is re-sent, so this used to
    // resolve `{ success: true }` having written nothing the cook could see.
    const { result } = await renderAlerts([
      makeItem({
        id: 'item-1',
        name: 'Peas',
        locationId: 'loc-freezer',
        locationType: 'freezer',
        expiresAt: daysFromNow(1),
      }),
    ]);

    let response;
    await act(async () => {
      response = await result.current.freezeAll(result.current.expiringItems[0]);
    });

    expect(response).toEqual({ success: false, error: 'That is already in the freezer.' });
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });
});

describe('useWasteAlerts.freezeHalf', () => {
  it('freezes half and leaves the rest where it was', async () => {
    const { result } = await renderAlerts([
      makeItem({
        id: 'item-1',
        name: 'Chicken Breast',
        quantity: 4,
        unit: 'lbs',
        locationType: 'fridge',
        expiresAt: daysFromNow(1),
      }),
    ]);

    let response;
    await act(async () => {
      response = await result.current.freezeHalf(result.current.expiringItems[0]);
    });

    expect(response).toMatchObject({ success: true, frozenQuantity: 2, remainingQuantity: 2 });

    const [, newItem] = fs.addDoc.mock.calls[0];
    expect(newItem).toMatchObject({
      name: 'Chicken Breast',
      quantity: 2,
      locationId: 'loc-freezer',
      locationType: 'freezer',
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    expect(patch.quantity).toBe(2);
    // Only the quantity changed on the half staying in the fridge.
    expect(patch).not.toHaveProperty('locationType');
  });

  it('refuses to split something there is only one of', async () => {
    const { result } = await renderAlerts([
      makeItem({ id: 'item-1', name: 'Milk', quantity: 1, expiresAt: daysFromNow(1) }),
    ]);

    let response;
    await act(async () => {
      response = await result.current.freezeHalf(result.current.expiringItems[0]);
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/Freeze all instead/);
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it.each([
    ['none of it', 0],
    ['exactly one', 1],
    ['a fraction', 0.5],
    ['an unparseable quantity', 'some'],
  ])('refuses to split %s', async (_label, quantity) => {
    const { result } = await renderAlerts([
      makeItem({ id: 'item-1', name: 'Chicken Breast', quantity, expiresAt: daysFromNow(1) }),
    ]);

    let response;
    await act(async () => {
      response = await result.current.freezeHalf(result.current.expiringItems[0]);
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/Freeze all instead/);
    // Nothing written either way: a second document with quantity 0 would be
    // rejected by the create rule, and a NaN quantity would corrupt both halves.
    expect(fs.addDoc).not.toHaveBeenCalled();
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('gives the frozen half the shelf life the cook chose for the whole', async () => {
    // Without this the new document fell back to the table's 270 frozen days
    // for chicken, so the two halves of one pack expired months apart.
    const { result } = await renderAlerts([
      makeItem({
        id: 'item-1',
        name: 'Chicken Breast',
        quantity: 4,
        locationType: 'fridge',
        expiresAt: daysFromNow(1),
        shelfLifeDays: 45,
        shelfLifeSource: 'custom',
      }),
    ]);

    await act(async () => {
      await result.current.freezeHalf(result.current.expiringItems[0]);
    });

    const [, written] = fs.addDoc.mock.calls[0];
    expect(written.shelfLifeDays).toBe(45);
    expect(written.shelfLifeSource).toBe('custom');
  });

  it('refuses to split something that is already frozen', async () => {
    const { result } = await renderAlerts([
      makeItem({
        id: 'item-1',
        name: 'Peas',
        quantity: 4,
        locationId: 'loc-freezer',
        locationType: 'freezer',
        expiresAt: daysFromNow(1),
      }),
    ]);

    let response;
    await act(async () => {
      response = await result.current.freezeHalf(result.current.expiringItems[0]);
    });

    expect(response).toEqual({ success: false, error: 'That is already in the freezer.' });
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('leaves the original alone when the frozen half cannot be written', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderAlerts([
      makeItem({ id: 'item-1', name: 'Chicken Breast', quantity: 4, expiresAt: daysFromNow(1) }),
    ]);
    fs.addDoc.mockRejectedValueOnce(new Error('offline'));

    let response;
    await act(async () => {
      response = await result.current.freezeHalf(result.current.expiringItems[0]);
    });

    expect(response.success).toBe(false);
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });
});
