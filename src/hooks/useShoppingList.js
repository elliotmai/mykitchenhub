// src/hooks/useShoppingList.js
// The shopping list the household keeps by hand — and by voice.
//
// Owns one collection (see firestore/SCHEMA_DOCUMENTATION.md):
//   users/{uid}/shoppingListItems/{itemId}
//
// This is deliberately a *second* source of shopping list rows. The week's
// meals already produce a list — buildShoppingList in useMealPlan.js derives it
// from mealPlanEntries and the inventory on every render, and nothing about it
// is stored. That works right up until something needs to add to the list from
// outside the meal plan: "we're out of bin bags", or the Alexa skill
// (functions/src/alexa/) taking "add milk" over the kitchen speaker. Neither
// has a meal to hang off, and neither can write to a list that only exists as
// a computed value.
//
// So: the derived list stays derived, this collection holds everything else,
// and mergeShoppingList puts the two back together for rendering.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import { friendlyError } from '../utils/firebaseErrors';
import { withRetry } from '../utils/retry';

/** The two states a hand-added row can be in. Mirrors the security rules. */
export const ITEM_STATUSES = ['pending', 'bought'];

/** Where a row came from. Mirrors the security rules. */
export const ITEM_SOURCES = ['manual', 'alexa'];

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * The same key buildShoppingList uses, for the same reason: two quantities only
 * add up when they are counted the same way, so a row is an ingredient *and* a
 * unit. Kept in step with useMealPlan.js and functions/src/alexa/shoppingList.js.
 */
export const shoppingKey = (name, unit) => `${normalize(name)}|${normalize(unit)}`;

/**
 * One list out of the two that produce it.
 *
 * A hand-added row that names something the week already needs is not a second
 * row — the cook asked for milk once, whether they typed it or the plan worked
 * it out. It folds into the derived row and lends it its `id`, which is what
 * makes that row tickable: only stored rows have somewhere to record "bought".
 *
 * @param {array} derived - from buildShoppingList()
 * @param {array} stored  - documents from this hook
 * @returns {array} rows carrying `fromPlan`, and `id`/`status` where stored
 */
export const mergeShoppingList = (derived = [], stored = []) => {
  const keyOf = (item) => item.key ?? shoppingKey(item.normalized || item.name, item.unit);

  // Two stored rows can share a key — added by hand on Monday, added again by
  // voice on Thursday. The first one is the one a derived row folds into; the
  // rest still render, because a document that cannot be reached is one nobody
  // can ever tick off or delete.
  const firstByKey = new Map();
  stored.forEach((item) => {
    const key = keyOf(item);
    if (!firstByKey.has(key)) firstByKey.set(key, item);
  });

  const folded = new Set();

  const merged = derived.map((item) => {
    const match = firstByKey.get(item.key);
    if (!match) return { ...item, fromPlan: true, status: 'pending' };

    folded.add(match);
    return {
      ...item,
      fromPlan: true,
      id: match.id,
      status: match.status || 'pending',
      source: match.source,
    };
  });

  const extras = stored
    .filter((item) => !folded.has(item))
    .map((item) => ({
      key: keyOf(item),
      id: item.id,
      name: item.name,
      normalized: item.normalized,
      quantity: item.quantity,
      unit: item.unit || '',
      status: item.status || 'pending',
      source: item.source,
      onHand: 0,
      otherUnits: [],
      haveInInventory: false,
      fromPlan: false,
    }));

  return [...merged, ...extras].sort(
    (a, b) => a.name.localeCompare(b.name) || String(a.unit).localeCompare(String(b.unit))
  );
};

/**
 * useShoppingList
 *
 * @returns {object} the stored rows, plus add/toggle/remove and a `merge`
 *                   helper bound to them
 */
export const useShoppingList = () => {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const itemsQuery = query(
      collection(db, 'users', user.uid, 'shoppingListItems'),
      orderBy('addedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      itemsQuery,
      (snapshot) => {
        setItems(
          snapshot.docs.map((snap) => {
            const data = snap.data();
            return {
              id: snap.id,
              ...data,
              unit: data.unit || '',
              key: shoppingKey(data.normalized || data.name, data.unit),
            };
          })
        );
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error loading shopping list:', err);
        setError(friendlyError(err, { action: 'load your shopping list' }));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const addItem = useCallback(
    async ({ name, quantity = 1, unit = '', source = 'manual', status = 'pending' }) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!String(name ?? '').trim()) return { success: false, error: 'Name is required.' };

      // The rules reject quantity <= 0, and "add milk" carries no number at
      // all — one of a thing is what somebody means when they do not say.
      //
      // `status` is a parameter because ticking off a row the meal plan derived
      // has nowhere else to go: that row is a computed value, so the only way
      // to remember it was bought is to store one that says so.
      const amount = Number(quantity);
      const safeQuantity = Number.isFinite(amount) && amount > 0 ? amount : 1;

      try {
        const docRef = await withRetry(() =>
          addDoc(collection(db, 'users', user.uid, 'shoppingListItems'), {
            name: String(name).trim(),
            normalized: normalize(name),
            quantity: safeQuantity,
            unit: String(unit ?? '').trim(),
            status: ITEM_STATUSES.includes(status) ? status : 'pending',
            source: ITEM_SOURCES.includes(source) ? source : 'manual',
            addedAt: serverTimestamp(),
            boughtAt: status === 'bought' ? serverTimestamp() : null,
          })
        );
        return { success: true, id: docRef.id };
      } catch (err) {
        console.error('Error adding shopping list item:', err);
        return { success: false, error: friendlyError(err, { action: 'add that to your list' }) };
      }
    },
    [user?.uid]
  );

  const setBought = useCallback(
    async (itemId, bought = true) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      try {
        await updateDoc(doc(db, 'users', user.uid, 'shoppingListItems', itemId), {
          status: bought ? 'bought' : 'pending',
          boughtAt: bought ? serverTimestamp() : null,
        });
        return { success: true };
      } catch (err) {
        console.error('Error updating shopping list item:', err);
        return { success: false, error: friendlyError(err, { action: 'update your list' }) };
      }
    },
    [user?.uid]
  );

  const removeItem = useCallback(
    async (itemId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      try {
        await deleteDoc(doc(db, 'users', user.uid, 'shoppingListItems', itemId));
        return { success: true };
      } catch (err) {
        console.error('Error removing shopping list item:', err);
        return { success: false, error: friendlyError(err, { action: 'remove that item' }) };
      }
    },
    [user?.uid]
  );

  /** Clear out what has already been bought — the end of a shopping trip. */
  const clearBought = useCallback(async () => {
    if (!user?.uid) return { success: false, error: 'Not authenticated' };

    const bought = items.filter((item) => item.status === 'bought');
    if (bought.length === 0) return { success: true, cleared: 0 };

    try {
      await Promise.all(
        bought.map((item) => deleteDoc(doc(db, 'users', user.uid, 'shoppingListItems', item.id)))
      );
      return { success: true, cleared: bought.length };
    } catch (err) {
      console.error('Error clearing bought items:', err);
      return { success: false, error: friendlyError(err, { action: 'clear your list' }) };
    }
  }, [user?.uid, items]);

  const pendingCount = useMemo(
    () => items.filter((item) => item.status !== 'bought').length,
    [items]
  );

  return {
    items,
    pendingCount,
    loading,
    error,
    addItem,
    setBought,
    removeItem,
    clearBought,
  };
};

export default useShoppingList;
