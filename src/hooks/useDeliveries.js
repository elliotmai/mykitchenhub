// src/hooks/useDeliveries.js
// The "Add Delivery" workflow (roadmap 5.3).
//
// Logging a box does four things in one go:
//   1. every ingredient lands in the fridge with a real expiry date,
//   2. the delivery is recorded so the history page has something to show,
//   3. the box's recipes are scheduled on cook days 1, 3, and 5,
//   4. the user's HelloFresh schedule is updated so the next box is expected.
//
// The scheduled meals go into `users/{uid}/mealPlanEntries` — the collection
// phase 7 owns and the meal plan page reads. Nothing here renders a meal; this
// hook only writes entries in phase 7's documented shape, with
// `source: 'hellofresh'`, so a delivery shows up on the user's week.

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
// Day keys are phase 7's format, so reuse its helper rather than a second one.
import { toDayKey } from './useMealPlan';
import { friendlyError } from '../utils/firebaseErrors';

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

/**
 * Local YYYY-MM-DD — phase 7's day-key format, re-exported so this module's
 * callers have one name for it. `toISOString` would shift the date west of
 * Greenwich, which is why the shared helper exists.
 */
export const toDateKey = (date) => toDayKey(date instanceof Date ? date : new Date(date));

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
        setError(friendlyError(err, { action: 'load your delivery history' }));
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

        // Cook days 1, 3, 5, written into the collection the meal plan page
        // reads. `usesIngredients` is what its "Mark as Cooked" decrements, so
        // cooking a delivered meal takes the box's own ingredients back out of
        // the fridge.
        const mealPlanEntriesRef = collection(db, 'users', user.uid, 'mealPlanEntries');
        await Promise.all(
          recipes.map((recipe, index) =>
            addDoc(mealPlanEntriesRef, {
              date: toDateKey(addDays(deliveryDate, cookDayOffset(index))),
              mealType: 'dinner',
              recipeId: recipe.id ?? null,
              recipeName: recipe.name ?? '',
              servings: Number(recipe.servings) > 0 ? Number(recipe.servings) : 2,
              status: 'planned',
              source: 'hellofresh',
              createdAt: serverTimestamp(),
              cookedAt: null,
              usesIngredients: (recipe.ingredients ?? [])
                .filter((ingredient) => ingredient?.name)
                .map((ingredient) => ({
                  name: ingredient.name,
                  normalized: String(ingredient.normalized ?? ingredient.name)
                    .toLowerCase()
                    .trim(),
                  quantity: Number(ingredient.quantity) > 0 ? Number(ingredient.quantity) : 1,
                  unit: ingredient.unit ?? '',
                })),
              batchGroup: null,
              notes: '',
              planId: null,
              // Not part of phase 7's shape, but harmless extra provenance:
              // it links a scheduled meal back to the box it came in.
              deliveryId: deliveryRef.id,
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
        return { success: false, error: friendlyError(err, { action: 'remove that delivery' }) };
      }
    },
    [user?.uid]
  );

  return { deliveries, loading, saving, error, addDelivery, deleteDelivery };
};

export default useDeliveries;
