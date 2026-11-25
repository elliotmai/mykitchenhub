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
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from '../backend/firestore';
import { httpsCallable } from '../backend/functions';
import { db, functions } from '../services/firebase';
import { useAuth } from './useAuth';
import useInventory from './useInventory';
import { friendlyError } from '../utils/firebaseErrors';
import { isFarmSupplied } from '../utils/farmEggs';
import { withRetry } from '../utils/retry';
import {
  canonicalUnit,
  cleanIngredientName,
  convertQuantity,
  ingredientAlternatives,
  ingredientKey,
  largerUnit,
  measureKey,
} from '../utils/ingredientMeasure';

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

/**
 * Is this meal still going to be cooked?
 *
 * `skipped` is part of the contract other sections write, so it has to mean
 * something here: a skipped meal buys no groceries and joins no batch session.
 */
export const isUpcoming = (entry) => entry?.status !== 'cooked' && entry?.status !== 'skipped';

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
 * Two quantities only add up when they are counted the same way.
 *
 * Every line is keyed on what the ingredient *is* (`ingredientKey`: prep notes
 * and plurals stripped, so "Carrots, peeled and chopped" and "carrot" are one
 * errand) and on what kind of measure it is in (`measureKey`: volume, weight,
 * or the unit itself). Volumes add to volumes and weights to weights, shown in
 * the largest unit any recipe used — "1 tbsp" plus "2 tsp" is "1⅔ tbsp" — but
 * "2 cups flour" and "200 g flour" stay two lines, because converting between
 * them needs a density nobody recorded.
 *
 * Mirrors functions/src/board/shoppingList.js, which builds the same list for
 * the board API.
 *
 * The indexer below lets a lookup tell "a different measure" from "no
 * measure recorded".
 */
const capitalizeFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

const indexStock = (inventoryItems) => {
  const byName = new Map();
  const staples = new Set();

  inventoryItems.forEach((item) => {
    const name = ingredientKey(item.normalized || item.name);
    if (!name) return;
    // Eggs the farm is laying count as always on hand (src/utils/farmEggs.js).
    if (item.alwaysHave === true || isFarmSupplied(item)) {
      staples.add(name);
      (Array.isArray(item.alsoCovers) ? item.alsoCovers : []).forEach((alias) => {
        const key = ingredientKey(alias);
        if (key) staples.add(key);
      });
    }
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ quantity: Number(item.quantity || 0), unit: item.unit || '' });
  });

  /**
   * What the kitchen has of this ingredient, split by whether it can be counted
   * against the recipe.
   *
   * `onHand` is stock measured in a way that converts to the unit the list
   * asks for — four gallons of salmon do not cover one fillet, so that goes in
   * `otherUnits` instead. An item stored with no unit at all is a third case:
   * that is a gap in the record rather than a different substance, so it
   * counts toward `onHand`.
   *
   * A staple (`alwaysHave`, or named in a staple's `alsoCovers` — bouillon
   * standing in for broth) covers any amount, so it answers `alwaysHave: true`
   * and the row lands in "already in your kitchen".
   */
  return (name, unit) => {
    if (staples.has(name)) return { onHand: 0, otherUnits: [], alwaysHave: true };
    const held = byName.get(name) || [];
    const wanted = canonicalUnit(unit);

    if (!wanted) {
      return { onHand: held.reduce((sum, entry) => sum + entry.quantity, 0), otherUnits: [] };
    }

    let onHand = 0;
    const otherUnits = [];
    held.forEach((entry) => {
      if (!canonicalUnit(entry.unit)) {
        onHand += entry.quantity;
        return;
      }
      const converted = convertQuantity(entry.quantity, entry.unit, wanted);
      if (converted === null) otherUnits.push(entry);
      else onHand += converted;
    });

    return { onHand: Math.round(onHand * 100) / 100, otherUnits };
  };
};

/**
 * Fold "vegetable or chicken broth" into "chicken broth" when the week already
 * needs chicken broth in a measure it can be added to. A choice that matches
 * nothing else stays its own line, worded as the recipe worded it.
 */
const foldAlternatives = (needed) => {
  [...needed.values()].forEach((item) => {
    const target = ingredientAlternatives(item.normalized)
      .map((alternative) => needed.get(`${alternative}|${item.measure}`))
      .find((candidate) => candidate && candidate !== item);
    if (!target) return;
    const unit = largerUnit(target.unit, item.unit);
    target.quantity =
      convertQuantity(target.quantity, target.unit, unit) +
      convertQuantity(item.quantity, item.unit, unit);
    target.unit = unit;
    needed.delete(item.key);
  });
};

/**
 * What still needs buying for the meals on the board.
 *
 * Sums each ingredient across every meal still to be cooked, then subtracts
 * what is already in the kitchen. Items fully covered by inventory stay on the
 * list marked `haveInInventory` so nothing silently disappears; `onHand` says
 * how much of a partly-covered item the kitchen already has.
 *
 * `boughtKeys` are the lines a cook has ticked off this week (stored on the
 * week's mealPlans document); those rows come back with `bought: true`.
 */
export const buildShoppingList = (entries = [], inventoryItems = [], boughtKeys = []) => {
  const onHandFor = indexStock(inventoryItems);
  const bought = new Set(boughtKeys);

  const needed = new Map();
  entries.filter(isUpcoming).forEach((entry) => {
    (entry.usesIngredients || []).forEach((ingredient) => {
      const normalized = ingredientKey(ingredient.normalized || ingredient.name);
      if (!normalized) return;
      const unit = canonicalUnit(ingredient.unit);
      const measure = measureKey(unit);
      const key = `${normalized}|${measure}`;
      const quantity = Number(ingredient.quantity || 0);
      const existing = needed.get(key);
      if (existing) {
        const shownIn = largerUnit(existing.unit, unit);
        existing.quantity =
          convertQuantity(existing.quantity, existing.unit, shownIn) +
          convertQuantity(quantity, unit, shownIn);
        existing.unit = shownIn;
      } else {
        needed.set(key, {
          key,
          // Cleaned of prep notes, first letter up: "Chicken breast", not
          // "Boneless Skinless Chicken Breast, Cut Into Bite-Sized Pieces".
          name: capitalizeFirst(cleanIngredientName(ingredient.name || normalized) || normalized),
          normalized,
          measure,
          quantity,
          unit,
        });
      }
    });
  });

  foldAlternatives(needed);

  return [...needed.values()]
    .map((item) => {
      const quantity = Math.round(item.quantity * 100) / 100;
      const { onHand, otherUnits, alwaysHave = false } = onHandFor(item.normalized, item.unit);
      return {
        ...item,
        quantity,
        onHand: alwaysHave ? quantity : onHand,
        otherUnits,
        alwaysHave,
        haveInInventory: alwaysHave || (onHand >= quantity && quantity > 0),
        bought: bought.has(item.key),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
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
  const planned = entries.filter(isUpcoming);
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
    // "Prep onion once — it's used in Curry and Curry" is the same meal twice,
    // not a cooking session worth planning.
    if (new Set(members.map((m) => m.recipeName)).size < 2) return;
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
  // Total each item's usage before subtracting anything. A recipe can list the
  // same ingredient twice ("1 tbsp butter for the pan, 2 tbsp for the sauce"),
  // and computing both patches against the item's *original* quantity would let
  // the second write win — quietly putting the butter back.
  const usedByItem = new Map();

  (entry?.usesIngredients || []).forEach((ingredient) => {
    const key = normalize(ingredient.normalized || ingredient.name);
    if (!key) return;
    const used = Number(ingredient.quantity || 0);
    if (!used) return;
    const match = inventoryItems.find((item) => normalize(item.normalized || item.name) === key);
    // A staple is never used up by a recipe: "always have" means topped up.
    if (!match || match.alwaysHave === true) return;
    const running = usedByItem.get(match.id);
    if (running) running.used += used;
    else usedByItem.set(match.id, { match, used });
  });

  const patches = [];
  usedByItem.forEach(({ match, used }, id) => {
    const next = Math.max(0, Math.round((Number(match.quantity || 0) - used) * 100) / 100);
    // Already at zero, or nothing to take — no point spending a write.
    if (next === Number(match.quantity)) return;
    patches.push({ id, name: match.name, quantity: next });
  });

  return patches;
};

// ---------------------------------------------------------------------------
// Generated plans
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD`, the only date shape the day cards and the rules accept. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Would the security rules accept this generated meal?
 *
 * A model can name a day in the wrong format or leave a meal unnamed. Writing
 * that produces a rejected document — or worse, one Firestore stores today and
 * refuses once production rules are on — so it is dropped before the write.
 */
export const isWritableEntry = (entry) =>
  Boolean(
    entry &&
    typeof entry.date === 'string' &&
    DAY_KEY_PATTERN.test(entry.date) &&
    String(entry.recipeName ?? '').trim()
  );

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

    // Bounded to the week on screen — roadmap 9.2.
    //
    // This used to subscribe to every meal ever planned and filter to the
    // current week in the browser. After a year of use that is ~1,000 documents
    // read and held live to render seven day cards, growing every week and
    // never shrinking. Nothing outside this hook sees the unfiltered list:
    // every consumer goes through `entriesByDay`, and generatePlan matches on
    // `planId === weekStart`.
    //
    // Day keys are ISO `YYYY-MM-DD` strings, so a lexicographic range is a
    // chronological one. The range and the orderBy are on the same field, which
    // the automatic single-field index already covers — no composite needed.
    const weekEnd = shiftDayKey(weekStart, 6);
    const entriesRef = collection(db, 'users', user.uid, 'mealPlanEntries');
    const q = query(
      entriesRef,
      where('date', '>=', weekStart),
      where('date', '<=', weekEnd),
      orderBy('date', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEntries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching meal plan:', err);
        setError(friendlyError(err, { action: 'load your meal plan' }));
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // Re-subscribes when the cook moves week, which is the point: the query is
    // now the week, not the whole history.
  }, [user?.uid, weekStart]);

  // ── Week document listener ───────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) {
      setPlan(null);
      return;
    }

    // Drop last week's document before the new one arrives, so the shopping
    // list and batch tips never belong to a week that is no longer on screen.
    setPlan(null);

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

  const boughtKeys = plan?.boughtKeys;
  const shoppingList = useMemo(
    () => buildShoppingList(weekEntries, inventoryItems, boughtKeys || []),
    [weekEntries, inventoryItems, boughtKeys]
  );

  const batchTips = useMemo(() => {
    // A stored tip is whatever the planner wrote — it can repeat a group or
    // omit one entirely, so give every tip a key of its own to render by.
    const aiTips = (plan?.batchCooking || [])
      .filter((tip) => tip && tip.title)
      .map((tip, index) => ({ ...tip, key: `ai-${tip.group || index}-${index}`, fromAi: true }));

    const seen = new Set(aiTips.map((tip) => tip.group).filter(Boolean));
    const derived = groupBatchTasks(weekEntries)
      .filter((tip) => !seen.has(tip.group))
      .map((tip) => ({ ...tip, key: `derived-${tip.group}` }));

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
      dishId = null,
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
          // A dish planned as itself: the recipe is chosen when cooking.
          ...(dishId ? { dishId } : {}),
        });
        return { success: true };
      } catch (err) {
        console.error('Error scheduling meal:', err);
        return {
          success: false,
          error: friendlyError(err, { action: 'add that meal to your plan' }),
        };
      }
    },
    [user?.uid]
  );

  /**
   * Amend a scheduled meal: how many it feeds, which sitting it is, what it is
   * called, a note to self.
   *
   * `rescheduleMeal` already moves a meal between days and `markCooked` already
   * ticks it off; this is everything else the rules allow to change. Kept
   * separate from both because moving a meal and rewriting it are different
   * intentions, and a drag that quietly renamed something would be a surprise.
   *
   * `createdAt` is never touched — the rules pin it, and editing tonight's
   * servings should not restamp when the meal was planned.
   */
  const updateMeal = useCallback(
    async (entryId, changes = {}) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!entryId) return { success: false, error: 'Unknown meal.' };

      const patch = {};

      if (changes.recipeName !== undefined) {
        const name = String(changes.recipeName).trim();
        if (!name) return { success: false, error: 'Give the meal a name.' };
        patch.recipeName = name;
      }

      if (changes.servings !== undefined) {
        const servings = Number(changes.servings);
        // The rules require servings > 0, so a zero would bounce off the
        // server with a permission error that says nothing useful.
        if (!Number.isFinite(servings) || servings <= 0) {
          return { success: false, error: 'Servings needs to be more than zero.' };
        }
        patch.servings = servings;
      }

      if (changes.mealType !== undefined) {
        if (!MEAL_TYPES.includes(changes.mealType)) {
          return { success: false, error: 'That is not a meal we know about.' };
        }
        patch.mealType = changes.mealType;
      }

      if (changes.notes !== undefined) patch.notes = String(changes.notes).trim();

      if (Object.keys(patch).length === 0) return { success: true, unchanged: true };

      try {
        await updateDoc(doc(db, 'users', user.uid, 'mealPlanEntries', entryId), patch);
        return { success: true };
      } catch (err) {
        console.error('Error editing meal:', err);
        return { success: false, error: friendlyError(err, { action: 'save that change' }) };
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
        return { success: false, error: friendlyError(err, { action: 'move that meal' }) };
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
        return { success: false, error: friendlyError(err, { action: 'remove that meal' }) };
      }
    },
    [user?.uid]
  );

  /**
   * Mark a meal cooked and take its ingredients out of the kitchen.
   *
   * The inventory writes go through useInventory.updateItem, which patches
   * only `quantity` — leaving `addedAt` alone, as the rules require.
   *
   * Cooking is not repeatable: a second call on an already-cooked meal would
   * take the ingredients out a second time, so it stops before the write.
   */
  const markCooked = useCallback(
    async (entry) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!entry?.id) return { success: false, error: 'Unknown meal.' };

      // Trust the board over the caller's copy — the entry a card was rendered
      // with can be a snapshot behind.
      const current = entries.find((candidate) => candidate.id === entry.id) || entry;
      if (current.status === 'cooked') {
        return { success: true, alreadyCooked: true, decremented: [], inventoryError: null };
      }

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
        return { success: false, error: friendlyError(err, { action: 'tick that meal off' }) };
      }
    },
    [user?.uid, entries, inventoryItems, updateItem]
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
      // Retried on a transient failure — roadmap 9.3. Generating a week costs
      // a Claude call and the cook is watching a spinner for it; giving up on
      // a dropped connection means paying for it twice, by hand.
      //
      // Safe because the callable only *returns* a plan. Everything that
      // writes — deleting the previous generation, adding the new entries —
      // happens below, after this has settled, so a second attempt cannot
      // double up anything.
      const response = await withRetry(() => callable({ weekStart, days: 7 }));
      const result = response?.data || {};
      const generated = result.plan;
      // The function validates its own output, but this client is what actually
      // writes — so anything the rules would reject is dropped here rather than
      // failing the whole batch on one bad meal.
      const writable = (generated?.entries || []).filter(isWritableEntry);

      if (!writable.length) {
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
        writable.map((entry) =>
          addDoc(collection(db, 'users', user.uid, 'mealPlanEntries'), {
            date: entry.date,
            mealType: MEAL_TYPES.includes(entry.mealType) ? entry.mealType : 'dinner',
            recipeId: entry.recipeId ?? null,
            recipeName: String(entry.recipeName).trim(),
            servings: Math.max(1, Math.round(Number(entry.servings) || 2)),
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

      // `createdAt` is immutable once the week exists — the rules compare it
      // against the stored value on every update, so re-stamping it here would
      // make regenerating a plan fail. Only a brand new week carries one.
      const planPatch = {
        weekStart,
        source: 'ai',
        status: 'active',
        generatedAt: serverTimestamp(),
        model: generated.model ?? null,
        degraded: Boolean(generated.degraded),
        shoppingList: generated.shoppingList || [],
        batchCooking: generated.batchCooking || [],
        notes: generated.notes || '',
      };
      if (!plan) planPatch.createdAt = serverTimestamp();

      await setDoc(doc(db, 'users', user.uid, 'mealPlans', weekStart), planPatch, { merge: true });

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
  }, [user?.uid, weekStart, entries, plan]);

  /**
   * Tick a line the week's meals produced off the list, or put it back.
   *
   * The tick lives on the week's own document (`boughtKeys`), keyed by the
   * line's `key` — ingredient and kind of measure, not the unit, so adding a
   * meal that changes "3 tbsp" into "¼ cup" does not untick it. A new week
   * starts with nothing ticked, which is what a new shop is.
   *
   * A week with no document yet (nothing was ever generated for it) gets a
   * minimal manual one; `generatePlan` merges into it later without touching
   * the ticks.
   */
  const setDerivedBought = useCallback(
    async (key, isBought) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!key) return { success: false, error: 'Nothing to tick.' };
      const planRef = doc(db, 'users', user.uid, 'mealPlans', weekStart);
      try {
        if (plan) {
          await updateDoc(planRef, {
            boughtKeys: isBought ? arrayUnion(key) : arrayRemove(key),
          });
        } else {
          await setDoc(planRef, {
            weekStart,
            source: 'manual',
            status: 'active',
            createdAt: serverTimestamp(),
            boughtKeys: isBought ? [key] : [],
          });
        }
        return { success: true };
      } catch (err) {
        console.error('Error ticking shopping line:', err);
        return {
          success: false,
          error: friendlyError(err, { action: 'update your shopping list' }),
        };
      }
    },
    [user?.uid, weekStart, plan]
  );

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
    setDerivedBought,
    batchTips,
    inventoryItems,
    loading,
    error,
    generating,
    scheduleMeal,
    updateMeal,
    rescheduleMeal,
    removeMeal,
    markCooked,
    generatePlan,
    goToWeek,
    goToThisWeek,
  };
};

export default useMealPlan;
