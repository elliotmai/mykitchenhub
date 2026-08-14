// src/hooks/useMealPlan.js
// Meal planning — roadmap 7.1 / 7.2 / 7.3.
//
// Owns two collections (see firestore/SCHEMA_DOCUMENTATION.md):
//   users/{uid}/mealPlanEntries/{entryId}  one scheduled meal
//   users/{uid}/mealPlans/{weekId}         the week's shopping list + batch tips
//
// Days are `YYYY-MM-DD` strings throughout, never Timestamps — the security
// rules enforce that, because a Timestamp would never match a day card's key.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../services/firebase';
import { useAuth } from './useAuth';
import useInventory from './useInventory';

// ---------------------------------------------------------------------------
// Day keys
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` for a Date, in local time — never UTC-shifted. */
export const toDayKey = (date) => {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Parse a `YYYY-MM-DD` key back into a local Date at midnight. */
export const fromDayKey = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** The Monday of the week containing `date`. */
export const startOfWeek = (date = new Date()) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - weekday);
  return d;
};

/** Shift a `YYYY-MM-DD` key by `days`. */
export const shiftDayKey = (key, days) => {
  const d = fromDayKey(key);
  d.setDate(d.getDate() + days);
  return toDayKey(d);
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The seven days of the week starting at `weekStart`, ready for rendering. */
export const buildWeekDays = (weekStart, today = toDayKey(new Date())) =>
  Array.from({ length: 7 }, (_, i) => {
    const key = shiftDayKey(weekStart, i);
    const date = fromDayKey(key);
    return {
      key,
      label: DAY_LABELS[i],
      dayOfMonth: date.getDate(),
      monthLabel: date.toLocaleDateString(undefined, { month: 'short' }),
      isToday: key === today,
      isPast: key < today,
    };
  });

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_ORDER = Object.fromEntries(MEAL_TYPES.map((t, i) => [t, i]));

/** Sort entries the way a day is actually eaten. */
export const sortEntries = (entries) =>
  [...entries].sort((a, b) => (MEAL_ORDER[a.mealType] ?? 9) - (MEAL_ORDER[b.mealType] ?? 9));

// ---------------------------------------------------------------------------
// Shopping list (7.1)
// ---------------------------------------------------------------------------

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * What still needs buying for the meals on the board.
 *
 * Sums each ingredient across every meal that has not been cooked yet, then
 * subtracts what is already in the kitchen. Items fully covered by inventory
 * stay on the list marked `haveInInventory` so nothing silently disappears.
 */
export const buildShoppingList = (entries = [], inventoryItems = []) => {
  const stock = new Map();
  inventoryItems.forEach((item) => {
    const key = normalize(item.normalized || item.name);
    stock.set(key, (stock.get(key) ?? 0) + Number(item.quantity || 0));
  });

  const needed = new Map();
  entries
    .filter((entry) => entry.status !== 'cooked')
    .forEach((entry) => {
      (entry.usesIngredients || []).forEach((ingredient) => {
        const key = normalize(ingredient.normalized || ingredient.name);
        if (!key) return;
        const existing = needed.get(key);
        const quantity = Number(ingredient.quantity || 0);
        if (existing) {
          existing.quantity += quantity;
        } else {
          needed.set(key, {
            name: ingredient.name || key,
            normalized: key,
            quantity,
            unit: ingredient.unit || '',
          });
        }
      });
    });

  return [...needed.values()]
    .map((item) => {
      const onHand = stock.get(item.normalized) ?? 0;
      return {
        ...item,
        quantity: Math.round(item.quantity * 100) / 100,
        onHand,
        haveInInventory: onHand >= item.quantity && item.quantity > 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

// ---------------------------------------------------------------------------
// Batch cooking (7.3)
// ---------------------------------------------------------------------------

/**
 * Meals worth cooking in one go.
 *
 * Two sources: an explicit `batchGroup` the AI assigned, and — for anything it
 * did not group — meals on different days that share a main ingredient, which
 * is the case where prepping once actually saves a second session at the stove.
 */
export const groupBatchTasks = (entries = []) => {
  const planned = entries.filter((entry) => entry.status !== 'cooked');
  const groups = [];
  const grouped = new Set();

  const byGroup = new Map();
  planned.forEach((entry) => {
    if (!entry.batchGroup) return;
    if (!byGroup.has(entry.batchGroup)) byGroup.set(entry.batchGroup, []);
    byGroup.get(entry.batchGroup).push(entry);
  });

  byGroup.forEach((members, group) => {
    if (members.length < 2) return;
    members.forEach((entry) => grouped.add(entry.id));
    groups.push({
      group,
      title: `Cook together: ${members.map((m) => m.recipeName).join(' + ')}`,
      detail: `These ${members.length} meals were planned as one cooking session.`,
      entryIds: members.map((m) => m.id),
      entryDates: members.map((m) => m.date),
    });
  });

  const byIngredient = new Map();
  planned.forEach((entry) => {
    if (grouped.has(entry.id)) return;
    (entry.usesIngredients || []).forEach((ingredient) => {
      const key = normalize(ingredient.normalized || ingredient.name);
      if (!key) return;
      if (!byIngredient.has(key))
        byIngredient.set(key, { name: ingredient.name || key, entries: [] });
      byIngredient.get(key).entries.push(entry);
    });
  });

  byIngredient.forEach(({ name, entries: members }, key) => {
    const days = new Set(members.map((m) => m.date));
    if (members.length < 2 || days.size < 2) return;
    groups.push({
      group: key,
      title: `Prep ${name} once`,
      detail: `${name} shows up in ${members.map((m) => m.recipeName).join(' and ')}. Prep it all on the first day and the second meal is mostly reheating.`,
      entryIds: members.map((m) => m.id),
      entryDates: [...days].sort(),
    });
  });

  return groups;
};

// ---------------------------------------------------------------------------
// Inventory decrement (7.1)
// ---------------------------------------------------------------------------

/**
 * What "Mark as Cooked" should subtract.
 *
 * Returns one `{ id, quantity }` patch per matched inventory item. Quantity
 * floors at zero: the security rules allow an update to 0 but not below, and a
 * half-stocked kitchen shouldn't block the cook from logging dinner.
 */
export const planInventoryDecrements = (entry, inventoryItems = []) => {
  const patches = [];
  (entry?.usesIngredients || []).forEach((ingredient) => {
    const key = normalize(ingredient.normalized || ingredient.name);
    if (!key) return;
    const match = inventoryItems.find((item) => normalize(item.normalized || item.name) === key);
    if (!match) return;
    const used = Number(ingredient.quantity || 0);
    if (!used) return;
    const next = Math.max(0, Math.round((Number(match.quantity || 0) - used) * 100) / 100);
    if (next === Number(match.quantity)) return;
    patches.push({ id: match.id, name: match.name, quantity: next });
  });
  return patches;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useMealPlan Hook
 *
 * Usage:
 *   const {
 *     weekStart, weekDays, entries, entriesByDay, plan, shoppingList, batchTips,
 *     scheduleMeal, rescheduleMeal, removeMeal, markCooked, generatePlan,
 *     goToWeek, loading, error, generating,
 *   } = useMealPlan();
 */
const useMealPlan = () => {
  const { user } = useAuth();
  const { items: inventoryItems, updateItem } = useInventory();

  const [weekStart, setWeekStart] = useState(() => toDayKey(startOfWeek()));
  const [entries, setEntries] = useState([]);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  // ── Entries listener ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const entriesRef = collection(db, 'users', user.uid, 'mealPlanEntries');
    const q = query(entriesRef, orderBy('date', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEntries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching meal plan:', err);
        setError('Failed to load your meal plan');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // ── Week document listener ───────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) {
      setPlan(null);
      return;
    }

    const planRef = doc(db, 'users', user.uid, 'mealPlans', weekStart);
    const unsubscribe = onSnapshot(
      planRef,
      (snapshot) => setPlan(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
      (err) => {
        console.error('Error fetching meal plan week:', err);
        setPlan(null);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, weekStart]);

  // ── Derived view of the current week ─────────────────────────────────────
  const weekDays = useMemo(() => buildWeekDays(weekStart), [weekStart]);

  const weekEntries = useMemo(() => {
    const keys = new Set(weekDays.map((d) => d.key));
    return entries.filter((entry) => keys.has(entry.date));
  }, [entries, weekDays]);

  const entriesByDay = useMemo(() => {
    const map = {};
    weekDays.forEach((day) => {
      map[day.key] = sortEntries(weekEntries.filter((entry) => entry.date === day.key));
    });
    return map;
  }, [weekDays, weekEntries]);

  const shoppingList = useMemo(
    () => buildShoppingList(weekEntries, inventoryItems),
    [weekEntries, inventoryItems]
  );

  const batchTips = useMemo(() => {
    const aiTips = (plan?.batchCooking || []).map((tip) => ({ ...tip, fromAi: true }));
    const seen = new Set(aiTips.map((tip) => tip.group));
    const derived = groupBatchTasks(weekEntries).filter((tip) => !seen.has(tip.group));
    return [...aiTips, ...derived];
  }, [plan, weekEntries]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const scheduleMeal = useCallback(
    async ({
      date,
      mealType = 'dinner',
      recipeId = null,
      recipeName,
      servings = 2,
      usesIngredients = [],
      source = 'manual',
      notes = '',
      batchGroup = null,
      planId = null,
    }) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!date) return { success: false, error: 'Pick a day for this meal.' };
      if (!recipeName?.trim()) return { success: false, error: 'Pick a recipe.' };
      if (!MEAL_TYPES.includes(mealType)) return { success: false, error: 'Invalid meal type.' };
      if (!servings || servings <= 0)
        return { success: false, error: 'Servings must be greater than 0.' };

      try {
        await addDoc(collection(db, 'users', user.uid, 'mealPlanEntries'), {
          date,
          mealType,
          recipeId,
          recipeName: recipeName.trim(),
          servings: Number(servings),
          status: 'planned',
          source,
          createdAt: serverTimestamp(),
          cookedAt: null,
          usesIngredients,
          batchGroup,
          notes,
          planId,
        });
        return { success: true };
      } catch (err) {
        console.error('Error scheduling meal:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  const rescheduleMeal = useCallback(
    async (entryId, date, mealType) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!date) return { success: false, error: 'Pick a day for this meal.' };

      try {
        const patch = { date };
        if (mealType) patch.mealType = mealType;
        await updateDoc(doc(db, 'users', user.uid, 'mealPlanEntries', entryId), patch);
        return { success: true };
      } catch (err) {
        console.error('Error rescheduling meal:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  const removeMeal = useCallback(
    async (entryId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'mealPlanEntries', entryId));
        return { success: true };
      } catch (err) {
        console.error('Error removing meal:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  /**
   * Mark a meal cooked and take its ingredients out of the kitchen.
   *
   * The inventory writes go through useInventory.updateItem, which patches
   * only `quantity` — leaving `addedAt` alone, as the rules require.
   */
  const markCooked = useCallback(
    async (entry) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!entry?.id) return { success: false, error: 'Unknown meal.' };

      const decrements = planInventoryDecrements(entry, inventoryItems);

      try {
        await updateDoc(doc(db, 'users', user.uid, 'mealPlanEntries', entry.id), {
          status: 'cooked',
          cookedAt: serverTimestamp(),
        });

        const results = await Promise.all(
          decrements.map((patch) => updateItem(patch.id, { quantity: patch.quantity }))
        );
        const failed = results.filter((r) => r && r.success === false);

        return {
          success: true,
          decremented: decrements,
          inventoryError: failed.length
            ? `Marked cooked, but ${failed.length} inventory item(s) could not be updated.`
            : null,
        };
      } catch (err) {
        console.error('Error marking meal cooked:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid, inventoryItems, updateItem]
  );

  /**
   * Ask the AI for a week (7.2), then persist it through the normal rules.
   *
   * The Cloud Function only generates — the client writes — so a plan is
   * subject to exactly the same validation as one built by hand, and a
   * regeneration replaces only the meals the AI put there.
   */
  const generatePlan = useCallback(async () => {
    if (!user?.uid) return { success: false, error: 'Not authenticated' };

    setGenerating(true);
    setError(null);

    try {
      const callable = httpsCallable(functions, 'generateMealPlan');
      const response = await callable({ weekStart, days: 7 });
      const result = response?.data || {};
      const generated = result.plan;

      if (!generated?.entries?.length) {
        setGenerating(false);
        const message = result?.warning || 'The planner did not return any meals. Try again.';
        setError(message);
        return { success: false, error: message };
      }

      // Replace only what a previous generation put on the board.
      const previous = entries.filter(
        (entry) => entry.source === 'ai' && entry.planId === weekStart && entry.status !== 'cooked'
      );
      await Promise.all(
        previous.map((entry) => deleteDoc(doc(db, 'users', user.uid, 'mealPlanEntries', entry.id)))
      );

      await Promise.all(
        generated.entries.map((entry) =>
          addDoc(collection(db, 'users', user.uid, 'mealPlanEntries'), {
            date: entry.date,
            mealType: entry.mealType || 'dinner',
            recipeId: entry.recipeId ?? null,
            recipeName: entry.recipeName,
            servings: Number(entry.servings) || 2,
            status: 'planned',
            source: 'ai',
            createdAt: serverTimestamp(),
            cookedAt: null,
            usesIngredients: entry.usesIngredients || [],
            batchGroup: entry.batchGroup ?? null,
            notes: entry.notes || '',
            planId: weekStart,
          })
        )
      );

      await setDoc(
        doc(db, 'users', user.uid, 'mealPlans', weekStart),
        {
          weekStart,
          createdAt: serverTimestamp(),
          source: 'ai',
          status: 'active',
          generatedAt: serverTimestamp(),
          model: generated.model ?? null,
          degraded: Boolean(generated.degraded),
          shoppingList: generated.shoppingList || [],
          batchCooking: generated.batchCooking || [],
          notes: generated.notes || '',
        },
        { merge: true }
      );

      setGenerating(false);
      return {
        success: true,
        warning: result?.warning || null,
        degraded: Boolean(generated.degraded),
      };
    } catch (err) {
      console.error('Error generating meal plan:', err);
      setGenerating(false);
      const message = err?.message || 'Could not generate a plan right now.';
      setError(message);
      return { success: false, error: message };
    }
  }, [user?.uid, weekStart, entries]);

  const goToWeek = useCallback((offsetWeeks) => {
    setWeekStart((current) => shiftDayKey(current, offsetWeeks * 7));
  }, []);

  const goToThisWeek = useCallback(() => setWeekStart(toDayKey(startOfWeek())), []);

  return {
    weekStart,
    weekDays,
    entries,
    weekEntries,
    entriesByDay,
    plan,
    shoppingList,
    batchTips,
    inventoryItems,
    loading,
    error,
    generating,
    scheduleMeal,
    rescheduleMeal,
    removeMeal,
    markCooked,
    generatePlan,
    goToWeek,
    goToThisWeek,
  };
};

export default useMealPlan;
