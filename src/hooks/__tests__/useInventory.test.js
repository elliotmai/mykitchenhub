// Covers the inventory hook: the pure expiration helpers (which drive every
// colour-coded badge in the UI) and the Firestore-backed CRUD surface.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useInventory, {
  SHELF_LIFE_DEFAULTS,
  calcExpiresAt,
  getExpirationStatus,
  getExpirationLabel,
} from '../useInventory';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeItem, daysFromNow, makeUserProfile } from '../../test-utils/factories';

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

    expect(result.current.error).toBe('Failed to load inventory');
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

    expect(response).toEqual({ success: false, error: 'quota exceeded' });
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

  // Documents current behaviour, which is arguably wrong: moving an item to
  // the freezer should extend its life, but the hook can't tell a *defaulted*
  // shelfLifeDays from a user-chosen one, so it keeps the old value. Phase 6
  // (6.1 Expiration Tracking Logic) owns the fix — when it lands, this test
  // should flip to expecting SHELF_LIFE_DEFAULTS.freezer.
  it('currently keeps the stored shelf life when only the location changes', async () => {
    const { result } = await renderInventory([
      makeItem({ id: 'item-1', locationType: 'fridge', shelfLifeDays: 7 }),
    ]);

    await act(async () => {
      await result.current.updateItem('item-1', { locationType: 'freezer' });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(7);
    expect(days).not.toBe(SHELF_LIFE_DEFAULTS.freezer);
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

    expect(response).toEqual({ success: false, error: 'offline' });
  });
});
