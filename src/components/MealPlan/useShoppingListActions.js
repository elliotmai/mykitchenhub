// src/components/MealPlan/useShoppingListActions.js
// The shopping list's write handlers, in one place.
//
// The list has two surfaces now — the Meal Plan page and its own screen — and
// they must behave identically: the same toast wording, the same busy row while
// a write is in flight, the same decision about what counts as an error worth
// interrupting a cook for. Two copies of that would drift on the first change
// to either.
//
// This owns the writes only. The list itself is read where it is rendered, so
// each surface holds one set of Firestore listeners rather than two.

import { useCallback, useState } from 'react';

import useShoppingList from '../../hooks/useShoppingList';
import { useToast } from '../Common';

/**
 * @returns {{
 *   busyItemId: string|null,
 *   onAddItem: (input: object) => Promise<object>,
 *   onToggleBought: (item: object, bought: boolean) => Promise<void>,
 *   onRemoveItem: (item: object) => Promise<void>,
 *   onEditItem: (item: object, changes: object) => Promise<object>,
 *   onClearBought: () => Promise<void>,
 * }}
 */
export const useShoppingListActions = () => {
  const { addItem, updateItem, setBought, removeItem, clearBought } = useShoppingList();
  const { showError, showInfo } = useToast();
  const [busyItemId, setBusyItemId] = useState(null);

  const onAddItem = useCallback(
    async (input) => {
      const result = await addItem(input);
      if (!result.success) showError(result.error || 'Could not add that to your shopping list.');
      return result;
    },
    [addItem, showError]
  );

  /**
   * Tick a typed item off, or put it back.
   *
   * Only manual rows reach here. A derived row has no document to mark, and
   * creating one on a tick would make the same list true in two places — so
   * derived rows have no checkbox at all.
   */
  const onToggleBought = useCallback(
    async (item, bought) => {
      setBusyItemId(item.id);
      const result = await setBought(item.id, bought);
      setBusyItemId(null);
      if (!result.success) showError(result.error || 'Could not update your shopping list.');
    },
    [setBought, showError]
  );

  const onRemoveItem = useCallback(
    async (item) => {
      setBusyItemId(item.id);
      const result = await removeItem(item.id);
      setBusyItemId(null);
      if (result.success) showInfo(`${item.name} taken off your shopping list.`);
      else showError(result.error || 'Could not remove that from your shopping list.');
    },
    [removeItem, showError, showInfo]
  );

  const onEditItem = useCallback(
    async (item, changes) => {
      setBusyItemId(item.id);
      const result = await updateItem(item.id, changes);
      setBusyItemId(null);
      if (!result.success) showError(result.error || 'Could not save that change.');
      // Handed back so the row can stay open on failure rather than closing
      // over a correction that never landed.
      return result;
    },
    [updateItem, showError]
  );

  const onClearBought = useCallback(async () => {
    const result = await clearBought();
    if (!result.success) showError(result.error || 'Could not clear what you have bought.');
    else if (result.cleared) showInfo(`Cleared ${result.cleared} item(s) off your shopping list.`);
  }, [clearBought, showError, showInfo]);

  return { busyItemId, onAddItem, onToggleBought, onRemoveItem, onEditItem, onClearBought };
};

export default useShoppingListActions;
