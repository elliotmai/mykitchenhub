// useShoppingList — the manual, ad-hoc part of the shopping list.
//
// The assertions that matter are about the *document*, because this is the
// only part of the shopping list with documents behind it and the security
// rules police every field. A test that only checked the returned array would
// pass on a write the rules reject.

import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import useShoppingList, {
  amountLabel,
  buildShoppingItem,
  combineShoppingList,
  findDuplicateNames,
  normalizeName,
  SHOPPING_ITEM_STATUSES,
} from '../useShoppingList';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeShoppingItem, makeUserProfile } from '../../test-utils/factories';
import { expectHumanError } from '../../test-utils/humanErrors';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

let uid;

const signIn = () => {
  const user = authMock.__user();
  authMock.__setUser(user);
  fs.getDoc.mockResolvedValue(fs.__doc(user.uid, makeUserProfile()));
  return user.uid;
};

const listPath = () => `users/${uid}/shoppingItems`;

/** Render the hook and wait for its listener to settle. */
const renderList = async () => {
  const view = renderHook(() => useShoppingList(), { wrapper });
  await waitFor(() => expect(fs.__listenerCount(listPath())).toBe(1));
  return view;
};

/** Push a snapshot at the hook the way Firestore would. */
const emit = async (items) => {
  await act(async () => {
    fs.__emit(listPath(), asDocs(items));
  });
};

/** The single document handed to addDoc, and the path it went to. */
const lastAdd = () => {
  const [ref, data] = fs.addDoc.mock.calls[fs.addDoc.mock.calls.length - 1];
  return { path: fs.pathOf(ref), data };
};

beforeEach(() => {
  uid = signIn();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('normalizeName', () => {
  it('lowercases and trims, so a typed name meets a derived one', () => {
    expect(normalizeName('  Milk ')).toBe('milk');
    expect(normalizeName('MILK')).toBe('milk');
  });

  it('survives nothing at all', () => {
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(null)).toBe('');
  });
});

describe('buildShoppingItem', () => {
  it('builds the document the security rules require, and nothing else', () => {
    const item = buildShoppingItem({ name: 'Batteries' });

    expect(item).toEqual({
      name: 'Batteries',
      normalized: 'batteries',
      quantity: 1,
      unit: '',
      notes: '',
      status: 'pending',
      source: 'manual',
      boughtAt: null,
    });
  });

  it('carries no haveInInventory — a manual item has no comparison to report', () => {
    // Absent rather than false: a `false` would claim the week-needs-versus-
    // kitchen-has question was asked and answered, and for batteries it never
    // was. ShoppingList.jsx must never bucket these by that field.
    const item = buildShoppingItem({ name: 'Batteries' });

    expect(item).not.toHaveProperty('haveInInventory');
    expect(item).not.toHaveProperty('onHand');
  });

  it('is not week-bound', () => {
    // "Buy batteries" is not a fact about a week, so nothing ties the document
    // to one. If a weekId is ever added, this is what says the decision changed.
    expect(buildShoppingItem({ name: 'Batteries' })).not.toHaveProperty('weekId');
  });

  it('trims the name, so a row of spaces never reaches Firestore', () => {
    expect(buildShoppingItem({ name: '  Birthday cake  ' })).toMatchObject({
      name: 'Birthday cake',
      normalized: 'birthday cake',
    });
  });

  it('refuses a name that is nothing but whitespace', () => {
    expect(buildShoppingItem({ name: '   ' })).toBeNull();
    expect(buildShoppingItem({ name: '' })).toBeNull();
    expect(buildShoppingItem({})).toBeNull();
    expect(buildShoppingItem()).toBeNull();
  });

  it('keeps the quantity and unit a cook typed', () => {
    expect(buildShoppingItem({ name: 'Milk', quantity: '2', unit: ' bottle ' })).toMatchObject({
      quantity: 2,
      unit: 'bottle',
    });
  });

  it('defaults an unusable quantity to one of the thing', () => {
    // Nothing typed means "one of those", not "zero of those" — and the rules
    // require > 0, so a zero would be rejected at the database.
    ['', null, undefined, 0, -3, 'lots', NaN].forEach((quantity) => {
      expect(buildShoppingItem({ name: 'Milk', quantity })).toMatchObject({ quantity: 1 });
    });
  });

  it('rounds a quantity to the two decimals the rest of the app uses', () => {
    // Same rounding as buildShoppingList, so a typed quantity and a derived one
    // are written to the same precision.
    expect(buildShoppingItem({ name: 'Flour', quantity: 1.2345 })).toMatchObject({
      quantity: 1.23,
    });
  });

  it('always starts pending — an item is added to be bought, not already bought', () => {
    expect(buildShoppingItem({ name: 'Milk', status: 'bought' })).toMatchObject({
      status: 'pending',
    });
    expect(SHOPPING_ITEM_STATUSES).toEqual(['pending', 'bought']);
  });
});

describe('findDuplicateNames', () => {
  const derived = (name, overrides = {}) => ({
    name,
    normalized: name.toLowerCase(),
    quantity: 2,
    unit: 'l',
    onHand: 0,
    haveInInventory: false,
    ...overrides,
  });

  it('spots a typed item the week also needs', () => {
    const found = findDuplicateNames([makeShoppingItem({ name: 'Milk' })], [derived('milk')]);
    expect([...found]).toEqual(['milk']);
  });

  it('matches across case and spacing', () => {
    const found = findDuplicateNames([makeShoppingItem({ name: '  MILK ' })], [derived('milk')]);
    expect([...found]).toEqual(['milk']);
  });

  it('says nothing about an item no recipe asked for', () => {
    const found = findDuplicateNames([makeShoppingItem({ name: 'Batteries' })], [derived('milk')]);
    expect(found.size).toBe(0);
  });

  it('ignores a derived row the kitchen already covers', () => {
    // Not a duplicate worth warning about: the week needs none of it bought,
    // and the cook typed it because they want it anyway.
    const found = findDuplicateNames(
      [makeShoppingItem({ name: 'Milk' })],
      [derived('milk', { haveInInventory: true })]
    );
    expect(found.size).toBe(0);
  });

  it('copes with empty lists on either side', () => {
    expect(findDuplicateNames().size).toBe(0);
    expect(findDuplicateNames([], [derived('milk')]).size).toBe(0);
    expect(findDuplicateNames([makeShoppingItem()], []).size).toBe(0);
  });
});

describe('amountLabel', () => {
  it('says nothing for one of something unmeasured', () => {
    expect(amountLabel({ quantity: 1, unit: '' })).toBeNull();
  });

  it('keeps a count that means something', () => {
    expect(amountLabel({ quantity: 6, unit: '' })).toBe('6');
    expect(amountLabel({ quantity: 1, unit: 'box' })).toBe('1 box');
    expect(amountLabel({ quantity: 2, unit: 'l' })).toBe('2 l');
  });

  it('falls back to the unit when there is no number', () => {
    expect(amountLabel({ quantity: 0, unit: 'bunch' })).toBe('bunch');
    expect(amountLabel({})).toBeNull();
    expect(amountLabel()).toBeNull();
  });
});

// The fridge board's view: one errand list, read from across the kitchen.
describe('combineShoppingList', () => {
  const derived = (name, overrides = {}) => ({
    key: `${name.toLowerCase()}|g`,
    name,
    normalized: name.toLowerCase(),
    quantity: 200,
    unit: 'g',
    onHand: 0,
    haveInInventory: false,
    ...overrides,
  });

  it('puts both halves of the list in one place', () => {
    const rows = combineShoppingList(
      [makeShoppingItem({ id: 's1', name: 'Batteries' })],
      [derived('Salmon', { quantity: 2, unit: 'fillet' })]
    );

    expect(rows.map((r) => r.name)).toEqual(['Batteries', 'Salmon']);
    expect(rows.map((r) => r.kind)).toEqual(['manual', 'derived']);
  });

  it('leads with what the cook typed', () => {
    // Same order as the panel on the meal plan page: the two surfaces should
    // not disagree about which end of the list a typed item lives at.
    const rows = combineShoppingList(
      [makeShoppingItem({ id: 's1', name: 'Batteries' })],
      [derived('Apples'), derived('Salmon')]
    );
    expect(rows[0].name).toBe('Batteries');
  });

  it('drops what has already been ticked off', () => {
    const rows = combineShoppingList(
      [
        makeShoppingItem({ id: 's1', name: 'Batteries' }),
        makeShoppingItem({ id: 's2', name: 'Kitchen roll', status: 'bought' }),
      ],
      []
    );
    expect(rows.map((r) => r.name)).toEqual(['Batteries']);
  });

  it('drops what the kitchen already covers', () => {
    const rows = combineShoppingList([], [derived('Rice', { haveInInventory: true })]);
    expect(rows).toEqual([]);
  });

  it('keeps a derived row whose haveInInventory never got set', () => {
    // Same rule as the panel: an absent flag means "still to buy", never
    // "already have".
    const { haveInInventory, ...withoutFlag } = derived('Salmon');
    expect(combineShoppingList([], [withoutFlag]).map((r) => r.name)).toEqual(['Salmon']);
  });

  it('gives one errand one row, keeping the typed one', () => {
    // Two "Milk" rows on a four-row board read as a rendering fault. This drops
    // a row; it does not add two numbers together — see findDuplicateNames for
    // the merge that is deliberately not done.
    const rows = combineShoppingList(
      [makeShoppingItem({ id: 's1', name: 'Milk', quantity: 2, unit: 'l' })],
      [derived('milk')]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Milk', amount: '2 l', kind: 'manual' });
  });

  it('collapses across case and spacing, like every other name match here', () => {
    const rows = combineShoppingList(
      [makeShoppingItem({ id: 's1', name: '  MILK ' })],
      [derived('milk')]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('manual');
  });

  it('does not collapse two different things', () => {
    const rows = combineShoppingList(
      [makeShoppingItem({ id: 's1', name: 'Batteries' })],
      [derived('Milk')]
    );
    expect(rows).toHaveLength(2);
  });

  it('keeps two derived lines that differ only by unit', () => {
    // buildShoppingList keys on ingredient *and* unit for a reason — 2 cups of
    // flour and 200 g of flour are two things to buy, not one.
    const rows = combineShoppingList(
      [],
      [
        derived('Flour', { key: 'flour|cup', quantity: 2, unit: 'cup' }),
        derived('Flour', { key: 'flour|g', quantity: 200, unit: 'g' }),
      ]
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount)).toEqual(['2 cup', '200 g']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('gives every row a key of its own', () => {
    const rows = combineShoppingList(
      [
        makeShoppingItem({ id: 's1', name: 'Batteries' }),
        makeShoppingItem({ id: 's2', name: 'Bin bags' }),
      ],
      [derived('Salmon')]
    );
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it('leaves out a bare "1" that tells the cook nothing', () => {
    const rows = combineShoppingList([makeShoppingItem({ id: 's1', name: 'Batteries' })], []);
    expect(rows[0].amount).toBeNull();
  });

  it('copes with nothing on either side', () => {
    expect(combineShoppingList()).toEqual([]);
    expect(combineShoppingList([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The listener
// ---------------------------------------------------------------------------

describe('the list itself', () => {
  it('subscribes to the signed-in cook’s own collection, newest first', async () => {
    await renderList();

    expect(fs.__listenerCount(listPath())).toBe(1);
    expect(fs.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('splits what is still to buy from what is already in the trolley', async () => {
    const { result } = await renderList();

    await emit([
      makeShoppingItem({ name: 'Batteries' }),
      makeShoppingItem({ name: 'Kitchen roll', status: 'bought' }),
    ]);

    expect(result.current.items).toHaveLength(2);
    expect(result.current.pending.map((i) => i.name)).toEqual(['Batteries']);
    expect(result.current.bought.map((i) => i.name)).toEqual(['Kitchen roll']);
  });

  it('treats a row with no status as still to buy', async () => {
    // Defensive rather than expected: the rules require `status`, so this can
    // only come from a document written before them. Filing it under "bought"
    // would hide it from the one list it exists to appear on.
    const { result } = await renderList();
    const { status, ...withoutStatus } = makeShoppingItem({ name: 'Old Row' });

    await emit([withoutStatus]);

    expect(result.current.pending.map((i) => i.name)).toEqual(['Old Row']);
    expect(result.current.bought).toHaveLength(0);
  });

  it('reports a read failure in words a cook can act on', async () => {
    const { result } = await renderList();

    await act(async () => {
      // An uncatalogued code, so the message falls through to the template that
      // names what failed — which is what pins the wording to this hook.
      fs.__emitError(listPath(), { code: 'unknown', message: 'FirebaseError: [code=unknown]' });
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expectHumanError(result.current.error, /shopping list/i);
    expect(result.current.loading).toBe(false);
  });

  it('holds nothing and listens to nothing when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useShoppingList(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(fs.__listenerCount(listPath())).toBe(0);
  });

  it('lets go of its listener when the panel unmounts', async () => {
    const { unmount } = await renderList();
    unmount();
    expect(fs.__listenerCount(listPath())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

describe('adding an item', () => {
  it('writes the documented shape to the cook’s own subcollection', async () => {
    const { result } = await renderList();

    await act(async () => {
      expect(await result.current.addItem({ name: 'Batteries' })).toEqual({ success: true });
    });

    const { path, data } = lastAdd();
    expect(path).toBe(listPath());
    expect(data).toMatchObject({
      name: 'Batteries',
      normalized: 'batteries',
      quantity: 1,
      unit: '',
      status: 'pending',
      source: 'manual',
      boughtAt: null,
    });
    expect(data.createdAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('refuses a blank item without spending a write', async () => {
    const { result } = await renderList();

    await act(async () => {
      const outcome = await result.current.addItem({ name: '   ' });
      expect(outcome.success).toBe(false);
      expectHumanError(outcome.error, /name/i);
    });

    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('says so in plain words when the write is refused', async () => {
    const { result } = await renderList();
    fs.addDoc.mockRejectedValueOnce({ code: 'unknown', message: 'FirebaseError: [code=unknown]' });

    await act(async () => {
      const outcome = await result.current.addItem({ name: 'Batteries' });
      expect(outcome.success).toBe(false);
      expectHumanError(outcome.error, /shopping list/i);
    });
  });

  it('does nothing at all when nobody is signed in', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useShoppingList(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect((await result.current.addItem({ name: 'Batteries' })).success).toBe(false);
    });
    expect(fs.addDoc).not.toHaveBeenCalled();
  });
});

describe('ticking an item off', () => {
  it('marks it bought rather than deleting it, so a mis-tap is undoable', async () => {
    const { result } = await renderList();
    await emit([makeShoppingItem({ id: 'shop-1', name: 'Batteries' })]);

    await act(async () => {
      expect(await result.current.setBought('shop-1')).toEqual({ success: true });
    });

    expect(fs.deleteDoc).not.toHaveBeenCalled();
    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`${listPath()}/shop-1`);
    expect(patch).toEqual({ status: 'bought', boughtAt: { __sentinel: 'serverTimestamp' } });
  });

  it('never touches createdAt — the rules pin it, and a tick is not when it was written down', async () => {
    const { result } = await renderList();
    await emit([makeShoppingItem({ id: 'shop-1' })]);

    await act(async () => {
      await result.current.setBought('shop-1');
    });

    expect(fs.updateDoc.mock.calls[0][1]).not.toHaveProperty('createdAt');
  });

  it('puts an item back on the list, clearing when it was bought', async () => {
    const { result } = await renderList();
    await emit([makeShoppingItem({ id: 'shop-1', status: 'bought' })]);

    await act(async () => {
      expect(await result.current.setBought('shop-1', false)).toEqual({ success: true });
    });

    expect(fs.updateDoc.mock.calls[0][1]).toEqual({ status: 'pending', boughtAt: null });
  });

  it('refuses an item it has no id for', async () => {
    const { result } = await renderList();

    await act(async () => {
      expect((await result.current.setBought(undefined)).success).toBe(false);
    });
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('explains a refused tick in plain words', async () => {
    const { result } = await renderList();
    await emit([makeShoppingItem({ id: 'shop-1' })]);
    fs.updateDoc.mockRejectedValueOnce({ code: 'permission-denied', message: 'FirebaseError' });

    await act(async () => {
      const outcome = await result.current.setBought('shop-1');
      expect(outcome.success).toBe(false);
      expectHumanError(outcome.error);
    });
  });
});

describe('removing an item', () => {
  it('deletes the document it was asked to', async () => {
    const { result } = await renderList();
    await emit([makeShoppingItem({ id: 'shop-1' })]);

    await act(async () => {
      expect(await result.current.removeItem('shop-1')).toEqual({ success: true });
    });

    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe(`${listPath()}/shop-1`);
  });

  it('refuses without an id', async () => {
    const { result } = await renderList();

    await act(async () => {
      expect((await result.current.removeItem()).success).toBe(false);
    });
    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });

  it('explains a refused delete in plain words', async () => {
    const { result } = await renderList();
    fs.deleteDoc.mockRejectedValueOnce({
      code: 'unknown',
      message: 'FirebaseError: [code=unknown]',
    });

    await act(async () => {
      const outcome = await result.current.removeItem('shop-1');
      expect(outcome.success).toBe(false);
      expectHumanError(outcome.error, /shopping list/i);
    });
  });
});

describe('clearing what has been bought', () => {
  it('deletes only the bought rows, and leaves the rest of the list alone', async () => {
    const { result } = await renderList();
    await emit([
      makeShoppingItem({ id: 'shop-1', name: 'Batteries' }),
      makeShoppingItem({ id: 'shop-2', name: 'Kitchen roll', status: 'bought' }),
      makeShoppingItem({ id: 'shop-3', name: 'Bin bags', status: 'bought' }),
    ]);

    await act(async () => {
      expect(await result.current.clearBought()).toEqual({ success: true, cleared: 2 });
    });

    const deleted = fs.deleteDoc.mock.calls.map(([ref]) => fs.pathOf(ref));
    expect(deleted).toEqual([`${listPath()}/shop-2`, `${listPath()}/shop-3`]);
  });

  it('spends no writes when nothing has been bought', async () => {
    const { result } = await renderList();
    await emit([makeShoppingItem({ id: 'shop-1' })]);

    await act(async () => {
      expect(await result.current.clearBought()).toEqual({ success: true, cleared: 0 });
    });
    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });

  it('clears what it can and says how much is still there', async () => {
    // One failure must not hide the rest: the cook needs to know the list on
    // screen is not the list in the database.
    const { result } = await renderList();
    await emit([
      makeShoppingItem({ id: 'shop-1', status: 'bought' }),
      makeShoppingItem({ id: 'shop-2', status: 'bought' }),
    ]);

    fs.deleteDoc
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ code: 'permission-denied', message: 'FirebaseError' });

    await act(async () => {
      const outcome = await result.current.clearBought();
      expect(outcome).toMatchObject({ success: false, cleared: 1 });
      expectHumanError(outcome.error);
    });
  });

  it('refuses when nobody is signed in', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useShoppingList(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect((await result.current.clearBought()).success).toBe(false);
    });
  });

  describe('updateItem', () => {
    it('saves a corrected name, and re-keys it for duplicate and aisle lookups', async () => {
      const { result } = await renderList();
      await act(async () => {
        await result.current.updateItem('item-1', { name: '  Milk  ' });
      });
      expect(fs.updateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'Milk', normalized: 'milk' })
      );
    });

    it('refuses a blank name rather than letting the rules bounce it back', async () => {
      const { result } = await renderList();
      let outcome;
      await act(async () => {
        outcome = await result.current.updateItem('item-1', { name: '   ' });
      });
      expect(outcome.success).toBe(false);
      expect(fs.updateDoc).not.toHaveBeenCalled();
    });

    it('refuses a quantity of zero, which the rules require to be positive', async () => {
      const { result } = await renderList();
      let outcome;
      await act(async () => {
        outcome = await result.current.updateItem('item-1', { quantity: 0 });
      });
      expect(outcome.success).toBe(false);
      expect(fs.updateDoc).not.toHaveBeenCalled();
    });

    it('writes nothing when nothing changed', async () => {
      const { result } = await renderList();
      let outcome;
      await act(async () => {
        outcome = await result.current.updateItem('item-1', {});
      });
      expect(outcome).toEqual({ success: true, unchanged: true });
      expect(fs.updateDoc).not.toHaveBeenCalled();
    });

    it('never touches createdAt, which the rules pin', async () => {
      const { result } = await renderList();
      await act(async () => {
        await result.current.updateItem('item-1', { name: 'Bread', quantity: 2 });
      });
      const patch = fs.updateDoc.mock.calls[0][1];
      expect(patch).not.toHaveProperty('createdAt');
      expect(patch).not.toHaveProperty('source');
    });
  });
});
