// src/hooks/useRecipeSuggestions.js
// Matches the shared recipe library against the food that is about to go off —
// roadmap 6.3.
//
// Reads the `recipes` collection per firestore.rules (any signed-in user may
// read it) and matches recipe `ingredients[].name` / `.normalized` against the
// inventory's `normalized` field.
//
// "Add to Meal Plan" writes a users/{uid}/mealPlanEntries document in the shape
// Phase 7 defines — that collection and its rules are Phase 7's, and its schema
// documentation names this button as one of its writers. The meal plan UI that
// renders these entries is Phase 7's too; this is only the link out.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  getDocs,
  limit as limitTo,
  query,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import { byExpirySoonestFirst } from './useInventory';
import { toDayKey } from './useMealPlan';
import { friendlyError } from '../utils/firebaseErrors';

/** Recipes pulled per lookup — plenty for matching, small enough to stay cheap. */
export const RECIPE_FETCH_LIMIT = 200;

/**
 * How meals scheduled from here are tagged.
 *
 * This is one of the `source` values Phase 7's mealPlanEntries rules allow —
 * it is their vocabulary, not ours, so it stays spelled their way.
 */
export const MEAL_PLAN_SOURCE = 'waste-prevention';

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .trim();

/** The normalized names a recipe ingredient could be known by. */
export const ingredientNames = (ingredient) => {
  if (typeof ingredient === 'string') return [normalize(ingredient)];
  return [normalize(ingredient?.normalized), normalize(ingredient?.name)].filter(Boolean);
};

/** Minimum name length before containment matching is allowed. */
const MIN_CONTAINMENT_LENGTH = 4;

/**
 * Crude singular form — enough for a kitchen, not for a dictionary.
 *
 * Recipes and shopping habits disagree about number: a recipe asks for "egg"
 * and the fridge holds "Eggs". Comparing the singular forms catches that
 * without loosening the containment rule below, which is what keeps "egg"
 * away from "eggplant".
 */
export const singularize = (word) => {
  if (word.length < 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
};

/**
 * Does a recipe ingredient refer to this inventory item?
 *
 * Three rules, loosest last:
 *   1. the same name (already lower-cased and trimmed by `normalize`)
 *   2. the same name but for plural — "egg" is "eggs"
 *   3. one contains the other, so a cook's "chicken" matches a recipe's
 *      "chicken breast"
 *
 * Rule 3 only applies to names of four characters or more; without that,
 * "egg" would match "eggplant" and put an aubergine curry at the top of the
 * list for someone with eggs to use up.
 */
export const ingredientMatchesItem = (ingredientName, itemName) => {
  const a = normalize(ingredientName);
  const b = normalize(itemName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (singularize(a) === singularize(b)) return true;
  if (a.length < MIN_CONTAINMENT_LENGTH || b.length < MIN_CONTAINMENT_LENGTH) return false;
  return a.includes(b) || b.includes(a);
};

/** A recipe's display name, tolerating both documented and legacy field names. */
export const recipeTitle = (recipe) => recipe?.name ?? recipe?.title ?? 'Untitled recipe';

/**
 * Score every recipe by how much of the at-risk food it would use up.
 *
 * Sorted by the number of expiring items used, then by which of those expires
 * soonest — a recipe that saves three things beats one that saves two, and a
 * tie is broken by urgency.
 */
export const matchRecipesToItems = (recipes, expiringItems) => {
  // Neither list is guaranteed: the recipe collection can be empty or still
  // loading, and a caller can pass whatever it has.
  if (!Array.isArray(recipes) || !Array.isArray(expiringItems)) return [];

  const matches = recipes.map((recipe) => {
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

    const usesItems = expiringItems.filter((item) =>
      ingredients.some((ingredient) =>
        ingredientNames(ingredient).some((name) =>
          ingredientMatchesItem(name, item.normalized ?? item.name)
        )
      )
    );

    return {
      recipe,
      title: recipeTitle(recipe),
      usesItems,
      matchCount: usesItems.length,
      soonestExpiry: usesItems.slice().sort(byExpirySoonestFirst)[0]?.expiresAt ?? null,
    };
  });

  return matches
    .filter((match) => match.matchCount > 0)
    .sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      const byExpiry = byExpirySoonestFirst(
        { expiresAt: a.soonestExpiry },
        { expiresAt: b.soonestExpiry }
      );
      if (byExpiry !== 0) return byExpiry;
      return a.title.localeCompare(b.title);
    });
};

/**
 * Today as YYYY-MM-DD in the cook's own timezone, not UTC.
 *
 * `toDayKey` is Phase 7's, and so is the `date` field this feeds. Sharing it
 * rather than keeping a second implementation means a meal scheduled from here
 * lands on the same day key the meal plan page reads back.
 */
export const todayIsoDate = (now = new Date()) => toDayKey(now);

/**
 * useRecipeSuggestions
 *
 * @param {Array} expiringItems - inventory documents to cook through
 */
const useRecipeSuggestions = (expiringItems = []) => {
  const { user } = useAuth();
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (!user?.uid) {
      setRecipes([]);
      setLoading(false);
      return undefined;
    }

    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(
          query(collection(db, 'recipes'), limitTo(RECIPE_FETCH_LIMIT))
        );
        if (cancelled) return;
        setRecipes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading recipes for suggestions:', err);
        setError(friendlyError(err, { action: 'find recipe ideas' }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const suggestions = useMemo(
    () => matchRecipesToItems(recipes, expiringItems),
    [recipes, expiringItems]
  );

  /**
   * Put a recipe on the meal plan for a given day.
   *
   * Writes users/{uid}/mealPlanEntries/{entryId} in Phase 7's documented shape:
   * a `date` string rather than a Timestamp, `source: 'waste-prevention'`, and
   * `usesIngredients` so Phase 7's "Mark as Cooked" knows what to decrement.
   * Every field is theirs — if that shape changes, this changes with it.
   */
  const addToMealPlan = useCallback(
    async (match, { date, mealType = 'dinner', servings } = {}) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      const recipe = match?.recipe ?? match;
      if (!recipe?.id) return { success: false, error: 'That recipe is missing an id.' };

      try {
        await addDoc(collection(db, 'users', user.uid, 'mealPlanEntries'), {
          date: date || todayIsoDate(),
          mealType,
          recipeId: recipe.id,
          recipeName: recipeTitle(recipe),
          servings: Number(servings ?? recipe.servings ?? 2),
          status: 'planned',
          source: MEAL_PLAN_SOURCE,
          createdAt: serverTimestamp(),
          cookedAt: null,
          // The expiring food this meal is meant to rescue, in the shape the
          // meal plan matches against inventory `normalized`.
          usesIngredients: (match?.usesItems ?? []).map((item) => ({
            name: item.name,
            normalized: item.normalized ?? normalize(item.name),
            quantity: Number(item.quantity) || 1,
            unit: item.unit || '',
          })),
          batchGroup: null,
          notes: '',
          planId: null,
        });

        return { success: true };
      } catch (err) {
        console.error('Error adding recipe to meal plan:', err);
        return {
          success: false,
          error: friendlyError(err, { action: 'add that recipe to your plan' }),
        };
      }
    },
    [user?.uid]
  );

  return {
    recipes,
    suggestions,
    loading,
    error,
    addToMealPlan,
  };
};

export default useRecipeSuggestions;
