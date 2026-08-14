// src/hooks/useRecipes.js
// Custom hook for the shared recipe library — Phase 4.1.
//
// `recipes` is a single global collection (see firestore/SCHEMA_DOCUMENTATION.md):
// every signed-in cook reads the same library, anyone can add to it, anyone can
// bump a recipe's cook count, and only recipes with `source: 'user-created'`
// can be deleted. The security rules enforce all of that, so this hook mirrors
// them client-side rather than discovering them through failed writes.
//
// Two rules are easy to trip over and are handled here once:
//   1. `name` and `createdAt` are immutable on update — a patch containing
//      either is rejected outright, so updateRecipe strips them.
//   2. Every create must carry the full required field set, even when the user
//      left the optional bits blank.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './useAuth';

// ---------------------------------------------------------------------------
// Contract constants — these mirror firestore.rules exactly.
// ---------------------------------------------------------------------------

/** Every value `source` is allowed to take. */
export const RECIPE_SOURCES = [
  'legacy',
  'spoonacular',
  'ai-generated',
  'user-created',
  'hellofresh',
];

/** Every value `difficulty` is allowed to take. */
export const DIFFICULTIES = ['easy', 'medium', 'hard'];

/** Fields the rules refuse to let an update change. */
const IMMUTABLE_FIELDS = ['name', 'createdAt', 'source'];

/** Human labels for each source, for filter menus and badges. */
export const SOURCE_LABELS = {
  legacy: "Let's Eat",
  spoonacular: 'Spoonacular',
  'ai-generated': 'AI written',
  'user-created': 'Yours',
  hellofresh: 'HelloFresh',
};

// ---------------------------------------------------------------------------
// Pure helpers — exported so components and tests can use them without a hook
// ---------------------------------------------------------------------------

/** Lowercased, whitespace-collapsed form used to match against inventory. */
export const normalizeName = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** Firestore Timestamp | Date | ISO string → milliseconds (0 when absent). */
export const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

/** Prep + cook time in minutes, or null when neither is recorded. */
export const totalTime = (recipe) => {
  const prep = Number(recipe?.prepTime) || 0;
  const cook = Number(recipe?.cookTime) || 0;
  const total = prep + cook;
  return total > 0 ? total : null;
};

/** Instructions may be an array of steps or one blob of text; always list steps. */
export const instructionSteps = (instructions) => {
  if (Array.isArray(instructions)) return instructions.filter((s) => String(s).trim().length > 0);
  if (typeof instructions === 'string') {
    return instructions
      .split(/\r?\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

/** Every tag across a list of recipes, de-duplicated and alphabetised. */
export const collectTags = (recipes = []) =>
  [...new Set(recipes.flatMap((r) => (Array.isArray(r.tags) ? r.tags : [])))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

/**
 * Free-text search across the fields a cook would actually search by: the
 * recipe name, its tags, and its ingredients.
 */
export const matchesSearch = (recipe, term) => {
  const q = normalizeName(term);
  if (!q) return true;

  const haystack = [
    recipe?.name,
    ...(Array.isArray(recipe?.tags) ? recipe.tags : []),
    ...(Array.isArray(recipe?.ingredients)
      ? recipe.ingredients.map((i) => i?.name ?? i?.normalized ?? '')
      : []),
  ]
    .map(normalizeName)
    .join(' ');

  return haystack.includes(q);
};

/**
 * Apply the recipe list's filter bar.
 *
 * @param {array}  recipes
 * @param {object} filters
 * @param {string} filters.search      - free text
 * @param {array}  filters.tags        - recipe must carry *every* selected tag
 * @param {string} filters.source      - '' for any
 * @param {string} filters.difficulty  - '' for any
 * @param {number} filters.maxMinutes  - prep+cook must fit inside this
 */
export const filterRecipes = (recipes = [], filters = {}) => {
  const { search = '', tags = [], source = '', difficulty = '', maxMinutes = null } = filters;

  return recipes.filter((recipe) => {
    if (!matchesSearch(recipe, search)) return false;
    if (source && recipe.source !== source) return false;
    if (difficulty && recipe.difficulty !== difficulty) return false;

    if (tags.length > 0) {
      const recipeTags = Array.isArray(recipe.tags) ? recipe.tags : [];
      if (!tags.every((t) => recipeTags.includes(t))) return false;
    }

    if (maxMinutes) {
      const time = totalTime(recipe);
      // A recipe with no timing recorded can't be promised to fit.
      if (time === null || time > maxMinutes) return false;
    }

    return true;
  });
};

/** Sort modes offered in the list header. */
export const SORT_MODES = [
  { value: 'newest', label: 'Newest first' },
  { value: 'name', label: 'A → Z' },
  { value: 'timesCooked', label: 'Most cooked' },
  { value: 'time', label: 'Quickest first' },
];

export const sortRecipes = (recipes = [], mode = 'newest') => {
  const list = [...recipes];

  switch (mode) {
    case 'name':
      return list.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
    case 'timesCooked':
      return list.sort((a, b) => (b.timesCooked ?? 0) - (a.timesCooked ?? 0));
    case 'time':
      return list.sort((a, b) => (totalTime(a) ?? Infinity) - (totalTime(b) ?? Infinity));
    case 'newest':
    default:
      return list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }
};

/** A non-negative number, or null for blank/absent/nonsense input. */
const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Turn the Add/Edit form's state into a document the security rules accept.
 * Exported so tests can assert the shape without going through Firestore.
 *
 * @param {object} input
 * @param {string} source - one of RECIPE_SOURCES (default 'user-created')
 */
export const buildRecipeDocument = (input = {}, source = 'user-created') => {
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .filter((i) => String(i?.name ?? '').trim().length > 0)
    .map((i) => ({
      name: String(i.name).trim(),
      quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1,
      unit: String(i.unit ?? '').trim(),
      normalized: normalizeName(i.name),
    }));

  const instructions = instructionSteps(input.instructions);

  const tags = [
    ...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => normalizeName(t))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return {
    name: String(input.name ?? '').trim(),
    ingredients,
    instructions,
    source,
    tags,
    servings: Number(input.servings) > 0 ? Number(input.servings) : 1,
    difficulty: DIFFICULTIES.includes(input.difficulty) ? input.difficulty : 'easy',
    timesCooked: numberOrNull(input.timesCooked) ?? 0,
    prepTime: numberOrNull(input.prepTime),
    cookTime: numberOrNull(input.cookTime),
    imageUrl: input.imageUrl || null,
  };
};

/** First validation error in `input`, or null when it's good to write. */
export const validateRecipe = (input = {}) => {
  if (!String(input.name ?? '').trim()) return 'Recipe name is required.';

  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : []).filter((i) =>
    String(i?.name ?? '').trim()
  );
  if (ingredients.length === 0) return 'Add at least one ingredient.';

  if (instructionSteps(input.instructions).length === 0)
    return 'Add at least one instruction step.';

  const servings = Number(input.servings);
  if (!servings || servings <= 0) return 'Servings must be greater than 0.';

  if (input.difficulty && !DIFFICULTIES.includes(input.difficulty))
    return 'Difficulty must be easy, medium, or hard.';

  return null;
};

/**
 * First validation error in a *partial* edit, or null.
 *
 * Only the fields actually being changed are checked, so bumping the servings
 * on a legacy recipe with no recorded instructions still goes through.
 */
export const validateRecipePatch = (updates = {}) => {
  if ('name' in updates && !String(updates.name ?? '').trim()) return 'Recipe name is required.';

  if ('ingredients' in updates) {
    const kept = (Array.isArray(updates.ingredients) ? updates.ingredients : []).filter((i) =>
      String(i?.name ?? '').trim()
    );
    if (kept.length === 0) return 'Add at least one ingredient.';
  }

  if ('instructions' in updates && instructionSteps(updates.instructions).length === 0)
    return 'Add at least one instruction step.';

  if ('servings' in updates && !(Number(updates.servings) > 0))
    return 'Servings must be greater than 0.';

  if ('difficulty' in updates && !DIFFICULTIES.includes(updates.difficulty))
    return 'Difficulty must be easy, medium, or hard.';

  return null;
};

/**
 * useRecipes Hook
 *
 * Usage:
 *   const { recipes, loading, error, addRecipe, updateRecipe,
 *           deleteRecipe, markCooked, getRecipeById, tags } = useRecipes();
 */
const useRecipes = () => {
  const { user } = useAuth();
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // -------------------------------------------------------------------------
  // Real-time listener on the shared library
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!user?.uid) {
      setRecipes([]);
      setLoading(false);
      return;
    }

    const q = query(collection(db, 'recipes'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setRecipes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching recipes:', err);
        setError('Failed to load recipes');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------
  const addRecipe = useCallback(
    async (input) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      const problem = validateRecipe(input);
      if (problem) return { success: false, error: problem };

      try {
        const payload = {
          ...buildRecipeDocument(input, 'user-created'),
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        };

        const ref = await addDoc(collection(db, 'recipes'), payload);
        return { success: true, id: ref?.id };
      } catch (err) {
        console.error('Error adding recipe:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  // -------------------------------------------------------------------------
  // Update
  //
  // `name`, `createdAt` and `source` are dropped rather than sent-and-rejected:
  // the rules compare them against the stored document, so including one fails
  // the whole write even when the value is identical in spirit but not in type.
  // -------------------------------------------------------------------------
  const updateRecipe = useCallback(
    async (recipeId, updates = {}) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!recipeId) return { success: false, error: 'Recipe not found.' };

      const problem = validateRecipePatch(updates);
      if (problem) return { success: false, error: problem };

      try {
        const existing = recipes.find((r) => r.id === recipeId);
        const merged = { ...existing, ...updates };
        const patch = {};
        // Rebuild through the same normaliser the create path uses, then keep
        // only the keys the caller actually asked to change.
        const rebuilt = buildRecipeDocument(merged, merged.source ?? 'user-created');

        Object.keys(updates).forEach((key) => {
          if (IMMUTABLE_FIELDS.includes(key)) return;
          patch[key] = key in rebuilt ? rebuilt[key] : updates[key];
        });

        if (Object.keys(patch).length === 0) return { success: true };

        patch.updatedAt = serverTimestamp();
        await updateDoc(doc(db, 'recipes', recipeId), patch);
        return { success: true };
      } catch (err) {
        console.error('Error updating recipe:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid, recipes]
  );

  // -------------------------------------------------------------------------
  // Delete — only ever allowed for user-created recipes
  // -------------------------------------------------------------------------
  const deleteRecipe = useCallback(
    async (recipeId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      const recipe = recipes.find((r) => r.id === recipeId);
      if (recipe && recipe.source !== 'user-created') {
        return {
          success: false,
          error: 'Only recipes you added yourself can be deleted.',
        };
      }

      try {
        await deleteDoc(doc(db, 'recipes', recipeId));
        return { success: true };
      } catch (err) {
        console.error('Error deleting recipe:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid, recipes]
  );

  // -------------------------------------------------------------------------
  // "I cooked this" — the Times Cooked counter behind the analytics phase
  // -------------------------------------------------------------------------
  const markCooked = useCallback(
    async (recipeId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      try {
        await updateDoc(doc(db, 'recipes', recipeId), {
          timesCooked: increment(1),
          lastCookedAt: serverTimestamp(),
        });
        return { success: true };
      } catch (err) {
        console.error('Error recording a cook:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  // -------------------------------------------------------------------------
  // Selectors
  // -------------------------------------------------------------------------
  const getRecipeById = useCallback(
    (recipeId) => recipes.find((r) => r.id === recipeId) ?? null,
    [recipes]
  );

  const tags = useMemo(() => collectTags(recipes), [recipes]);

  const search = useCallback(
    (term, filters = {}) => filterRecipes(recipes, { ...filters, search: term }),
    [recipes]
  );

  return {
    recipes,
    loading,
    error,
    tags,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    markCooked,
    getRecipeById,
    search,
  };
};

export default useRecipes;
