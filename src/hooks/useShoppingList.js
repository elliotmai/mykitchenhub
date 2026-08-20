// src/hooks/useShoppingList.js
// The part of the shopping list a cook types in themselves.
//
// Everything else on that list is derived and stored nowhere:
// `buildShoppingList` in src/hooks/useMealPlan.js walks the week's meals,
// subtracts the kitchen, and returns a fresh array on every render. That is
// right for "2 fillets of salmon" and useless for "batteries" — no recipe is
// ever going to ask for those, so nothing derives them and nothing remembers
// them.
//
// This hook owns users/{uid}/shoppingItems/{itemId}, the only stored part of
// the list. See firestore/SCHEMA_DOCUMENTATION.md §8 for the shape and the
// reasoning; the short version:
//
//   * Items are NOT week-bound. A derived row belongs to the week whose meals
//     produced it. "Buy batteries" is not a fact about a week, so it survives
//     the week rolling over and lives until it is ticked off and cleared, or
//     deleted.
//   * There is no `haveInInventory` and no `onHand`. Those answer "the week
//     needs 2, the kitchen has 1", a question a manual item does not pose.
//     Absent, not `false` — a `false` would claim the comparison was made.
//   * Ticking off marks bought rather than deleting, so a mis-tap in a shop is
//     one tap to undo. Derived rows are not tickable at all: they have no
//     document, and inventing one here would make the same list true in two
//     places.

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

/** The two states a manual item can be in — mirrors the `status` enum. */
export const SHOPPING_ITEM_STATUSES = ['pending', 'bought'];

/**
 * Lowercased and trimmed, for matching one name against another.
 *
 * The same normalisation `buildShoppingList` uses, so a typed "Milk" and a
 * derived "milk" recognise each other.
 */
export const normalizeName = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * The document an added item becomes.
 *
 * Split out from the write so a test can assert the shape the security rules
 * see without a round trip, and so the rules test suite has one place to copy
 * from. Returns null when there is no name left after trimming: a blank row is
 * unreadable on the list and the rules reject it anyway.
 */
export const buildShoppingItem = ({ name, quantity = 1, unit = '', notes = '' } = {}) => {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return null;

  // A cook who types nothing in the quantity box means "one of those", not
  // "zero of those" — and the rules require > 0.
  const parsed = Number(quantity);
  const cleanQuantity = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 1;

  return {
    name: cleanName,
    normalized: normalizeName(cleanName),
    quantity: cleanQuantity,
    unit: String(unit ?? '').trim(),
    notes: String(notes ?? '').trim(),
    status: 'pending',
    source: 'manual',
    boughtAt: null,
  };
};

/**
 * Which manual items name something the week's meals also need.
 *
 * Returns a Set of normalized names. Deliberately *not* a merge: the two
 * quantities come from different places and one of them is a guess, so adding
 * "1" (typed, meaning a bottle) to "200 g" (computed from a recipe) produces a
 * number that is wrong in both units. The list shows both rows and says so.
 *
 * Only rows still to buy count. Something the kitchen already covers is not a
 * duplicate worth warning about — the cook typed it because they want it
 * anyway.
 */
export const findDuplicateNames = (manualItems = [], derivedItems = []) => {
  const derived = new Set(
    derivedItems
      .filter((item) => !item.haveInInventory)
      .map((item) => normalizeName(item.normalized || item.name))
      .filter(Boolean)
  );

  return new Set(
    manualItems
      .map((item) => normalizeName(item.normalized || item.name))
      .filter((name) => name && derived.has(name))
  );
};

/**
 * "2 fillet", or nothing at all.
 *
 * A bare "1" is noise — "Batteries 1" tells a cook nothing they had not already
 * assumed — so one of something unmeasured shows no amount. Anything else does.
 *
 * Lives here rather than in a component because both surfaces that render a
 * shopping row use it: the panel on the meal plan page and the fridge board.
 */
export const amountLabel = (item) => {
  const quantity = Number(item?.quantity ?? 0);
  const unit = String(item?.unit ?? '').trim();
  if (!quantity) return unit || null;
  if (quantity === 1 && !unit) return null;
  return unit ? `${quantity} ${unit}` : String(quantity);
};

/**
 * The whole list as one errand list: typed items and the week's own, together.
 *
 * For the fridge board, which answers one question from across the kitchen —
 * what do I need to buy — and has no room to explain where each line came from.
 *
 * Only what is still outstanding: a manual item already ticked off is not on the
 * fridge any more, and a derived line the kitchen already covers was never
 * something to buy.
 *
 * **One row per errand.** If a cook typed "milk" and the week's meals also need
 * milk, that is one thing to pick up, and two "Milk" rows on a five-row board
 * read as a rendering fault rather than as information. The typed row wins,
 * because it is the cook's own words.
 *
 * This is not the merge that `findDuplicateNames` deliberately avoids. That one
 * would *add* a typed "1" to a computed "200 g" and put the sum on screen — a
 * number that is wrong in both units. Nothing is added here: one row is
 * dropped, and the surviving row keeps its own quantity untouched. The meal plan
 * page still shows both, with the note, which is where a cook can act on the
 * difference.
 */
export const combineShoppingList = (manualItems = [], derivedItems = []) => {
  const outstandingManual = manualItems.filter((item) => item.status !== 'bought');
  const claimed = new Set(
    outstandingManual.map((item) => normalizeName(item.normalized || item.name)).filter(Boolean)
  );

  const rows = outstandingManual.map((item) => ({
    key: `manual-${item.id}`,
    name: item.name,
    amount: amountLabel(item),
    kind: 'manual',
    // The document itself, for surfaces that can act on the row rather than
    // only show it. A derived row deliberately has no equivalent: there is no
    // document behind it to tick off or take away.
    item,
  }));

  derivedItems
    .filter((item) => item.haveInInventory !== true)
    .filter((item) => !claimed.has(normalizeName(item.normalized || item.name)))
    .forEach((item) => {
      rows.push({
        key: `derived-${item.key ?? `${item.normalized} ${item.unit}`}`,
        name: item.name,
        amount: amountLabel(item),
        kind: 'derived',
      });
    });

  return rows;
};

/**
 * useShoppingList Hook
 *
 * Usage:
 *   const {
 *     items, pending, bought, loading, error,
 *     addItem, setBought, removeItem, clearBought,
 *   } = useShoppingList();
 */
const useShoppingList = () => {
  const { user } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setItems([]);
      setLoading(false);
      return;
    }

    // The whole list, newest first — an item the cook just typed belongs at the
    // top of a narrow panel where they can see it landed. Ordered on one field,
    // so the automatic single-field index covers it.
    //
    // Unbounded on purpose: this collection is the length of a shopping list,
    // not of a year of meals, and `clearBought` is one tap away.
    const ref = collection(db, 'users', user.uid, 'shoppingItems');
    const q = query(ref, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setItems(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching shopping list:', err);
        setError(friendlyError(err, { action: 'load your shopping list' }));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const pending = useMemo(() => items.filter((item) => item.status !== 'bought'), [items]);
  const bought = useMemo(() => items.filter((item) => item.status === 'bought'), [items]);

  const addItem = useCallback(
    async (input) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      const document = buildShoppingItem(input);
      if (!document) return { success: false, error: 'Give the item a name.' };

      try {
        await addDoc(collection(db, 'users', user.uid, 'shoppingItems'), {
          ...document,
          createdAt: serverTimestamp(),
        });
        return { success: true };
      } catch (err) {
        console.error('Error adding shopping item:', err);
        return {
          success: false,
          error: friendlyError(err, { action: 'add that to your shopping list' }),
        };
      }
    },
    [user?.uid]
  );

  /**
   * Tick an item off, or put it back.
   *
   * `createdAt` is untouched — the rules pin it, and a tick is not the moment
   * the cook wrote the item down.
   */
  /**
   * Amend a typed item: fix a spelling, change how many, add a unit.
   *
   * Only manual rows have documents, so only they can be edited — a derived
   * line is the week's arithmetic and changing it here would be changing the
   * answer without changing the question.
   *
   * `normalized` is recomputed rather than carried over: it is what duplicate
   * detection and the aisle lookup key off, so leaving the old one behind after
   * a rename would file "Milk" under whatever it used to be called.
   */
  const updateItem = useCallback(
    async (itemId, changes = {}) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!itemId) return { success: false, error: 'Unknown item.' };

      const patch = {};

      if (changes.name !== undefined) {
        const cleanName = String(changes.name).trim();
        // The rules refuse a blank name, and rightly — a nameless row is
        // unreadable on the list and unnameable in a conversation about it.
        // Saying so here beats letting the write bounce off the server.
        if (!cleanName) return { success: false, error: 'Give the item a name.' };
        patch.name = cleanName;
        patch.normalized = normalizeName(cleanName);
      }

      if (changes.quantity !== undefined) {
        const cleanQuantity = Number(changes.quantity);
        if (!Number.isFinite(cleanQuantity) || cleanQuantity <= 0) {
          return { success: false, error: 'How many? It needs to be more than zero.' };
        }
        patch.quantity = cleanQuantity;
      }

      if (changes.unit !== undefined) patch.unit = String(changes.unit).trim();
      if (changes.notes !== undefined) patch.notes = String(changes.notes).trim();

      if (Object.keys(patch).length === 0) return { success: true, unchanged: true };

      try {
        await updateDoc(doc(db, 'users', user.uid, 'shoppingItems', itemId), patch);
        return { success: true };
      } catch (err) {
        console.error('Error editing shopping item:', err);
        return { success: false, error: friendlyError(err, { action: 'save that change' }) };
      }
    },
    [user?.uid]
  );

  const setBought = useCallback(
    async (itemId, isBought = true) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!itemId) return { success: false, error: 'Unknown item.' };

      try {
        await updateDoc(doc(db, 'users', user.uid, 'shoppingItems', itemId), {
          status: isBought ? 'bought' : 'pending',
          boughtAt: isBought ? serverTimestamp() : null,
        });
        return { success: true };
      } catch (err) {
        console.error('Error updating shopping item:', err);
        return {
          success: false,
          error: friendlyError(err, {
            action: isBought ? 'tick that off' : 'put that back on the list',
          }),
        };
      }
    },
    [user?.uid]
  );

  const removeItem = useCallback(
    async (itemId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!itemId) return { success: false, error: 'Unknown item.' };

      try {
        await deleteDoc(doc(db, 'users', user.uid, 'shoppingItems', itemId));
        return { success: true };
      } catch (err) {
        console.error('Error removing shopping item:', err);
        return {
          success: false,
          error: friendlyError(err, { action: 'remove that from your shopping list' }),
        };
      }
    },
    [user?.uid]
  );

  /**
   * Clear everything already bought.
   *
   * This is what keeps "ticking off marks bought" from turning into a list that
   * only ever grows. Deletes are independent, so one failure does not hide the
   * rest — the count of what went is what the caller reports.
   */
  const clearBought = useCallback(async () => {
    if (!user?.uid) return { success: false, error: 'Not authenticated' };
    if (!bought.length) return { success: true, cleared: 0 };

    try {
      const results = await Promise.all(
        bought.map((item) =>
          deleteDoc(doc(db, 'users', user.uid, 'shoppingItems', item.id)).then(
            () => true,
            (err) => {
              console.error('Error clearing shopping item:', err);
              return false;
            }
          )
        )
      );
      const cleared = results.filter(Boolean).length;

      return cleared === results.length
        ? { success: true, cleared }
        : {
            success: false,
            cleared,
            error: `Cleared ${cleared} of ${results.length} — the rest are still on the list.`,
          };
    } catch (err) {
      console.error('Error clearing bought shopping items:', err);
      return {
        success: false,
        error: friendlyError(err, { action: 'clear what you have bought' }),
      };
    }
  }, [user?.uid, bought]);

  return {
    items,
    pending,
    bought,
    loading,
    error,
    addItem,
    updateItem,
    setBought,
    removeItem,
    clearBought,
  };
};

export default useShoppingList;
