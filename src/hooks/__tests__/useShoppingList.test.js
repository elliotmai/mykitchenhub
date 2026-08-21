// The shopping list a household keeps by hand — and the merge that puts it back
// together with the list this week's meals imply.
//
// The merge is where the interesting cases live: the same thing arriving from
// both sources is one row, not two, and a stored row is what makes a row
// tickable at all.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useShoppingList, { mergeShoppingList, shoppingKey } from '../useShoppingList';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs } from '../../test-utils/factories';

const UID = 'test-uid';
const LIST_PATH = `users/${UID}/shoppingListItems`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

/** A row as it comes back from Firestore. */
const storedItem = (overrides = {}) => ({
  id: 'item-1',
  name: 'Milk',
  normalized: 'milk',
  quantity: 1,
  unit: '',
  status: 'pending',
  source: 'manual',
  ...overrides,
});

/** A row as buildShoppingList derives it from the week. */
const derivedItem = (overrides = {}) => ({
  key: 'salmon|fillet',
  name: 'Salmon',
  normalized: 'salmon',
  quantity: 2,
  unit: 'fillet',
  onHand: 0,
  otherUnits: [],
  haveInInventory: false,
  ...overrides,
});

const renderList = async (items = []) => {
  authMock.__setUser(authMock.__user({ uid: UID }));

  const view = renderHook(() => useShoppingList(), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(LIST_PATH, asDocs(items));
  });
  return view;
};

// ---------------------------------------------------------------------------
// mergeShoppingList
// ---------------------------------------------------------------------------

describe('mergeShoppingList', () => {
  it('is the derived list when nothing was added by hand', () => {
    const merged = mergeShoppingList([derivedItem()], []);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: 'Salmon', fromPlan: true, status: 'pending' });
    // Nothing stored means nothing to tick off against.
    expect(merged[0].id).toBeUndefined();
  });

  it('carries hand-added rows the week knows nothing about', () => {
    const merged = mergeShoppingList([], [{ ...storedItem(), key: 'milk|' }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: 'Milk', fromPlan: false, id: 'item-1' });
  });

  it('folds a hand-added row into the derived one it names', () => {
    const stored = {
      ...storedItem({ name: 'Salmon', normalized: 'salmon', unit: 'fillet' }),
      key: 'salmon|fillet',
    };

    const merged = mergeShoppingList([derivedItem()], [stored]);

    // One salmon, not two — the cook asked for it once.
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: 'Salmon',
      quantity: 2,
      fromPlan: true,
      // …and it is tickable now, because there is a document to record it on.
      id: 'item-1',
    });
  });

  it('keeps the same ingredient in two units apart, as the derived list does', () => {
    const cups = derivedItem({ key: 'flour|cup', name: 'Flour', normalized: 'flour', unit: 'cup' });
    const grams = {
      ...storedItem({ name: 'Flour', normalized: 'flour', unit: 'g' }),
      key: 'flour|g',
    };

    const merged = mergeShoppingList([cups], [grams]);

    expect(merged).toHaveLength(2);
  });

  it('carries the bought state through, so a ticked row stays ticked', () => {
    const stored = {
      ...storedItem({ status: 'bought', name: 'Salmon', normalized: 'salmon', unit: 'fillet' }),
      key: 'salmon|fillet',
    };

    expect(mergeShoppingList([derivedItem()], [stored])[0].status).toBe('bought');
  });

  it('renders a duplicate stored row rather than swallowing it', () => {
    const first = { ...storedItem({ id: 'item-1', status: 'bought' }), key: 'milk|' };
    const second = { ...storedItem({ id: 'item-2' }), key: 'milk|' };

    const merged = mergeShoppingList([], [first, second]);

    // Both exist as documents, so both have to be reachable — otherwise the
    // second one can never be ticked off or deleted.
    expect(merged.map((item) => item.id).sort()).toEqual(['item-1', 'item-2']);
  });

  it('marks where a row came from, so the list can say what was added by voice', () => {
    const byVoice = { ...storedItem({ source: 'alexa' }), key: 'milk|' };

    expect(mergeShoppingList([], [byVoice])[0].source).toBe('alexa');
  });

  it('sorts by name, then unit', () => {
    const merged = mergeShoppingList(
      [
        derivedItem({ key: 'flour|g', name: 'Flour', unit: 'g' }),
        derivedItem({ key: 'apples|', name: 'Apples', unit: '' }),
        derivedItem({ key: 'flour|cup', name: 'Flour', unit: 'cup' }),
      ],
      []
    );

    expect(merged.map((item) => `${item.name} ${item.unit}`.trim())).toEqual([
      'Apples',
      'Flour cup',
      'Flour g',
    ]);
  });

  it('is empty when both sources are', () => {
    expect(mergeShoppingList()).toEqual([]);
  });
});

describe('shoppingKey', () => {
  it('keys on the ingredient and the unit it is counted in', () => {
    expect(shoppingKey(' Flour ', 'Cup')).toBe('flour|cup');
    expect(shoppingKey('flour', '')).toBe('flour|');
  });
});

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

describe('useShoppingList', () => {
  it('subscribes to the signed-in cook list and counts what is still to buy', async () => {
    const { result } = await renderList([
      storedItem({ id: 'a' }),
      storedItem({ id: 'b', name: 'Bread', normalized: 'bread', status: 'bought' }),
    ]);

    expect(result.current.items).toHaveLength(2);
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('gives every row a merge key, even one stored without a unit', async () => {
    const { result } = await renderList([storedItem()]);
    expect(result.current.items[0].key).toBe('milk|');
  });

  it('writes a row the security rules would accept', async () => {
    const { result } = await renderList();

    await act(async () => {
      await result.current.addItem({ name: '  Milk  ' });
    });

    const [ref, payload] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(LIST_PATH);
    expect(payload).toMatchObject({
      name: 'Milk',
      normalized: 'milk',
      quantity: 1,
      unit: '',
      status: 'pending',
      source: 'manual',
      boughtAt: null,
    });
    expect(payload.addedAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('never writes a quantity the rules would reject', async () => {
    const { result } = await renderList();

    await act(async () => {
      await result.current.addItem({ name: 'milk', quantity: 0 });
      await result.current.addItem({ name: 'bread', quantity: -3 });
      await result.current.addItem({ name: 'eggs', quantity: 'six' });
    });

    fs.addDoc.mock.calls.forEach(([, payload]) => expect(payload.quantity).toBe(1));
  });

  it('refuses a source the rules do not allow', async () => {
    const { result } = await renderList();

    await act(async () => {
      await result.current.addItem({ name: 'milk', source: 'smuggled' });
    });

    expect(fs.addDoc.mock.calls[0][1].source).toBe('manual');
  });

  it('can store a row that was already bought — a ticked-off meal plan row', async () => {
    const { result } = await renderList();

    await act(async () => {
      await result.current.addItem({
        name: 'Salmon',
        quantity: 2,
        unit: 'fillet',
        status: 'bought',
      });
    });

    const [, payload] = fs.addDoc.mock.calls[0];
    expect(payload.status).toBe('bought');
    expect(payload.boughtAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('will not add a nameless row', async () => {
    const { result } = await renderList();

    let outcome;
    await act(async () => {
      outcome = await result.current.addItem({ name: '   ' });
    });

    expect(outcome).toEqual({ success: false, error: 'Name is required.' });
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('ticks a row off and back on', async () => {
    const { result } = await renderList([storedItem()]);

    await act(async () => {
      await result.current.setBought('item-1');
    });
    expect(fs.updateDoc.mock.calls[0][1]).toMatchObject({ status: 'bought' });
    expect(fs.pathOf(fs.updateDoc.mock.calls[0][0])).toBe(`${LIST_PATH}/item-1`);

    await act(async () => {
      await result.current.setBought('item-1', false);
    });
    expect(fs.updateDoc.mock.calls[1][1]).toEqual({ status: 'pending', boughtAt: null });
  });

  it('removes a row', async () => {
    const { result } = await renderList([storedItem()]);

    await act(async () => {
      await result.current.removeItem('item-1');
    });

    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe(`${LIST_PATH}/item-1`);
  });

  it('clears only what was bought at the end of a shop', async () => {
    const { result } = await renderList([
      storedItem({ id: 'a', status: 'bought' }),
      storedItem({ id: 'b', name: 'Bread', normalized: 'bread' }),
      storedItem({ id: 'c', name: 'Eggs', normalized: 'eggs', status: 'bought' }),
    ]);

    let outcome;
    await act(async () => {
      outcome = await result.current.clearBought();
    });

    expect(outcome).toEqual({ success: true, cleared: 2 });
    expect(fs.deleteDoc.mock.calls.map(([ref]) => fs.pathOf(ref)).sort()).toEqual([
      `${LIST_PATH}/a`,
      `${LIST_PATH}/c`,
    ]);
  });

  it('spends no writes clearing a list with nothing bought on it', async () => {
    const { result } = await renderList([storedItem()]);

    await act(async () => {
      await result.current.clearBought();
    });

    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });

  it('reports a rejected write in words a cook can act on', async () => {
    const { result } = await renderList();
    fs.addDoc.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'permission-denied' })
    );

    let outcome;
    await act(async () => {
      outcome = await result.current.addItem({ name: 'milk' });
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toEqual(expect.any(String));
  });

  it('surfaces a failing subscription rather than spinning forever', async () => {
    authMock.__setUser(authMock.__user({ uid: UID }));
    const { result } = renderHook(() => useShoppingList(), { wrapper });
    await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());

    await act(async () => {
      fs.__emitError(LIST_PATH, new Error('offline'));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toEqual(expect.any(String));
  });

  it('does nothing at all when nobody is signed in', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useShoppingList(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.addItem({ name: 'milk' });
    });

    expect(outcome).toEqual({ success: false, error: 'Not authenticated' });
    expect(result.current.items).toEqual([]);
  });
});
