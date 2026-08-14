// src/hooks/useDeliveries.js
// The "Add Delivery" workflow (roadmap 5.3).
//
// Logging a box does four things in one go:
//   1. every ingredient lands in the fridge with a real expiry date,
//   2. the delivery is recorded so the history page has something to show,
//   3. the box's recipes are scheduled on cook days 1, 3, and 5,
//   4. the user's HelloFresh schedule is updated so the next box is expected.
//
// Meal plan documents are written here, but nothing in this hook renders one —
// the meal plan UI is roadmap phase 7 and owns that side.

import { useCallback, useEffect, useState } from 'react';
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
import { useIngredientMetadata } from './useIngredientMetadata';
import { SHELF_LIFE_DEFAULTS } from './useInventory';

/**
 * Cook days within the delivery week. Day 1 is delivery day, then every other
 * day — so a three-meal box lands on days 1, 3, and 5. Bigger boxes carry on
 * from there rather than piling two meals onto one evening.
 */
export const cookDayOffset = (index) => index * 2;

/** Human day-of-week name, which is what `helloFresh.deliveryDay` stores. */
export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** Local YYYY-MM-DD. `toISOString` would shift the date in western timezones. */
export function toDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function addDays(date, days) {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** Monday of the week a delivery falls in. */
export function weekOf(date) {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  // getDay(): 0 = Sunday. Shift so Monday is the start of the week.
  const offset = (d.getDay() + 6) % 7;
  return toDateKey(addDays(d, -offset));
}

/**
 * Collapse the ingredients of several recipes into one shopping list, so two
 * recipes that both want garlic produce one inventory row rather than two.
 */
export function mergeIngredients(recipes) {
  const merged = new Map();

  (recipes ?? []).forEach((recipe) => {
    (recipe?.ingredients ?? []).forEach((ingredient) => {
      const name = String(ingredient?.name ?? '').trim();
      if (!name) return;

      const normalized = String(ingredient?.normalized ?? name)
        .toLowerCase()
        .trim();
      const unit = String(ingredient?.unit ?? '').trim();
      const quantity = Number(ingredient?.quantity);
      // The inventory rules require quantity > 0 on create.
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

      // Only combine amounts that share a unit — 2 cloves + 1 tbsp is not 3.
      const key = `${normalized}::${unit.toLowerCase()}`;
      const existing = merged.get(key);

      if (existing) existing.quantity += safeQuantity;
      else merged.set(key, { name, normalized, unit, quantity: safeQuantity });
    });
  });

  return [...merged.values()];
}

/**
 * useDeliveries
 *
 * const { deliveries, loading, error, addDelivery, deleteDelivery } = useDeliveries();
 */
const useDeliveries = () => {
  const { user } = useAuth();
  const { getShelfLife } = useIngredientMetadata();

  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Real-time listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user?.uid) {
      setDeliveries([]);
      setLoading(false);
      return undefined;
    }

    const deliveriesRef = collection(db, 'users', user.uid, 'deliveries');
    const q = query(deliveriesRef, orderBy('deliveredAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setDeliveries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching deliveries:', err);
        setError('Failed to load delivery history');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // ---------------------------------------------------------------------------
  // Expiration
  // ---------------------------------------------------------------------------

  /**
   * Shelf life for an ingredient in a location, falling back to the location's
   * default when the reference data has no entry for that pairing (rice has no
   * fridge life, but a HelloFresh box still puts it in the fridge).
   */
  const shelfLifeFor = useCallback(
    (name, locationType) =>
      getShelfLife(name, locationType) ?? SHELF_LIFE_DEFAULTS[locationType] ?? 7,
    [getShelfLife]
  );

  // ---------------------------------------------------------------------------
  // Add delivery
  // ---------------------------------------------------------------------------
  const addDelivery = useCallback(
    async ({ recipes = [], deliveredAt = new Date(), location, notes = '' } = {}) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!location?.id) {
        return { success: false, error: 'Choose where the ingredients should go.' };
      }
      if (!['fridge', 'freezer', 'pantry'].includes(location.type)) {
        return { success: false, error: 'That storage location cannot hold ingredients.' };
      }

      const deliveryDate = deliveredAt instanceof Date ? deliveredAt : new Date(deliveredAt);
      if (Number.isNaN(deliveryDate.getTime())) {
        return { success: false, error: 'Enter a valid delivery date.' };
      }

      const ingredients = mergeIngredients(recipes);

      setSaving(true);
      setError(null);

      try {
        // The delivery doc first, so scheduled meals can point back at it.
        const deliveryRef = await addDoc(collection(db, 'users', user.uid, 'deliveries'), {
          deliveredAt: deliveryDate,
          weekOf: weekOf(deliveryDate),
          recipeIds: recipes.map((recipe) => recipe.id).filter(Boolean),
          recipeNames: recipes.map((recipe) => recipe.name ?? '').filter(Boolean),
          mealCount: recipes.length,
          itemsAdded: ingredients.length,
          locationId: location.id,
          status: 'received',
          source: 'hellofresh',
          notes: notes ?? '',
          createdAt: serverTimestamp(),
        });

        // Everything in the box, into the fridge, with a real expiry date.
        const inventoryRef = collection(db, 'users', user.uid, 'inventory');
        await Promise.all(
          ingredients.map((ingredient) => {
            const shelfLifeDays = shelfLifeFor(ingredient.normalized, location.type);
            return addDoc(inventoryRef, {
              name: ingredient.name,
              normalized: ingredient.normalized,
              quantity: ingredient.quantity,
              unit: ingredient.unit,
              locationId: location.id,
              locationType: location.type,
              addedAt: serverTimestamp(),
              expiresAt: addDays(deliveryDate, shelfLifeDays),
              shelfLifeDays,
              notes: '',
              source: 'hellofresh',
              purchaseHistory: [],
              totalTimesPurchased: 1,
              deliveryId: deliveryRef.id,
            });
          })
        );

        // Cook days 1, 3, 5. The meal plan UI (phase 7) renders these.
        const mealPlanRef = collection(db, 'users', user.uid, 'mealPlan');
        await Promise.all(
          recipes.map((recipe, index) =>
            addDoc(mealPlanRef, {
              date: toDateKey(addDays(deliveryDate, cookDayOffset(index))),
              mealType: 'dinner',
              recipeId: recipe.id,
              recipeName: recipe.name ?? '',
              servings: Number(recipe.servings) > 0 ? Number(recipe.servings) : 2,
              source: 'hellofresh',
              status: 'planned',
              deliveryId: deliveryRef.id,
              createdAt: serverTimestamp(),
            })
          )
        );

        // Remember the schedule so the next box is expected.
        await updateDoc(doc(db, 'users', user.uid), {
          'helloFresh.enabled': true,
          'helloFresh.deliveryDay': WEEKDAYS[deliveryDate.getDay()],
          'helloFresh.mealsPerWeek': recipes.length,
          'helloFresh.lastDeliveryDate': deliveryDate,
          'helloFresh.nextDeliveryDate': addDays(deliveryDate, 7),
        });

        return {
          success: true,
          id: deliveryRef.id,
          itemsAdded: ingredients.length,
          mealsScheduled: recipes.length,
        };
      } catch (err) {
        console.error('Error adding delivery:', err);
        return { success: false, error: 'That delivery could not be saved. Please try again.' };
      } finally {
        setSaving(false);
      }
    },
    [shelfLifeFor, user?.uid]
  );

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------
  const deleteDelivery = useCallback(
    async (deliveryId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      try {
        await deleteDoc(doc(db, 'users', user.uid, 'deliveries', deliveryId));
        return { success: true };
      } catch (err) {
        console.error('Error deleting delivery:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  return { deliveries, loading, saving, error, addDelivery, deleteDelivery };
};

export default useDeliveries;
