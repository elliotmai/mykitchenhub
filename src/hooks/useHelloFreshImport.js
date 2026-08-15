// src/hooks/useHelloFreshImport.js
// Drives the three ways a HelloFresh recipe gets into the app — a photo of the
// card, a link to the recipe page, or typing it in — and the review step that
// every one of them ends at.
//
// The Cloud Functions only parse. This hook does the actual write, so the
// recipe is created under the signed-in user's credentials and the `recipes`
// security rules apply.

import { useCallback, useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import {
  HelloFreshImportError,
  importFromPhoto,
  importFromUrl,
  isImportConfigured,
  looksLikeHelloFreshUrl,
  readImageFile,
} from '../services/helloFreshApi';

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

/** A blank draft, for the manual-entry fallback. */
export const emptyDraft = () => ({
  name: '',
  ingredients: [{ name: '', quantity: 1, unit: '' }],
  instructions: [''],
  source: 'hellofresh',
  tags: ['hellofresh'],
  prepTime: null,
  cookTime: null,
  servings: 2,
  difficulty: 'easy',
  timesCooked: 0,
  imageUrl: null,
  sourceUrl: null,
});

/** Lower-cased, punctuation-free name — must match the Cloud Function's rule. */
export const normalizeIngredientName = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Everything the `recipes` rules reject, checked before we attempt the write so
 * the cook gets a pointed message instead of "permission denied".
 *
 * @returns {string[]} empty when the draft is savable
 */
export function validateDraft(draft) {
  const problems = [];
  if (!draft?.name?.trim()) problems.push('Give the recipe a name.');

  const ingredients = (draft?.ingredients ?? []).filter((item) => item?.name?.trim());
  if (ingredients.length === 0) problems.push('Add at least one ingredient.');
  if (ingredients.some((item) => !(Number(item.quantity) > 0))) {
    problems.push('Every ingredient needs a quantity greater than zero.');
  }

  const instructions = (draft?.instructions ?? []).filter((step) => String(step ?? '').trim());
  if (instructions.length === 0) problems.push('Add at least one cooking step.');

  if (!(Number(draft?.servings) > 0)) problems.push('Servings must be greater than zero.');
  if (!DIFFICULTIES.includes(draft?.difficulty)) problems.push('Choose a difficulty.');

  return problems;
}

/** Strip a draft down to the document the rules accept, dropping empty rows. */
export function toRecipeDocument(draft) {
  const tags = Array.from(new Set([...(draft.tags ?? []), 'hellofresh'].filter(Boolean)));

  return {
    name: draft.name.trim(),
    ingredients: (draft.ingredients ?? [])
      .filter((item) => item?.name?.trim())
      .map((item) => ({
        name: item.name.trim(),
        quantity: Number(item.quantity),
        unit: String(item.unit ?? '').trim(),
        normalized: normalizeIngredientName(item.name),
      })),
    instructions: (draft.instructions ?? [])
      .map((step) => String(step ?? '').trim())
      .filter(Boolean),
    source: 'hellofresh',
    tags,
    prepTime: Number.isFinite(Number(draft.prepTime)) ? Number(draft.prepTime) : null,
    cookTime: Number.isFinite(Number(draft.cookTime)) ? Number(draft.cookTime) : null,
    servings: Number(draft.servings),
    difficulty: draft.difficulty,
    timesCooked: 0,
    imageUrl: draft.imageUrl ?? null,
    sourceUrl: draft.sourceUrl ?? null,
  };
}

/**
 * useHelloFreshImport
 *
 * const {
 *   draft, warnings, importing, saving, error,
 *   importPhoto, importUrl, startManualEntry, updateDraft, saveDraft, reset
 * } = useHelloFreshImport();
 */
const useHelloFreshImport = () => {
  const { user } = useAuth();

  const [draft, setDraft] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const configured = useMemo(() => isImportConfigured(), []);

  const fail = useCallback((err) => {
    const problem =
      err instanceof HelloFreshImportError
        ? { code: err.code, message: err.message, details: err.details ?? [] }
        : { code: 'unknown', message: 'Something went wrong. Try again.', details: [] };
    setError(problem);
    return { success: false, error: problem };
  }, []);

  const reset = useCallback(() => {
    setDraft(null);
    setWarnings([]);
    setError(null);
    setImporting(false);
    setSaving(false);
  }, []);

  /** Photograph of a recipe card → reviewable draft. */
  const importPhoto = useCallback(
    async (file) => {
      setError(null);
      setImporting(true);
      try {
        const { image, mediaType } = await readImageFile(file);
        const result = await importFromPhoto({ image, mediaType });
        setDraft(result.recipe);
        setWarnings(result.warnings);
        return { success: true, recipe: result.recipe, warnings: result.warnings };
      } catch (err) {
        return fail(err);
      } finally {
        setImporting(false);
      }
    },
    [fail]
  );

  /** HelloFresh recipe link → reviewable draft. */
  const importUrl = useCallback(
    async (url) => {
      setError(null);

      if (!looksLikeHelloFreshUrl(url)) {
        return fail(
          new HelloFreshImportError(
            'invalid-url',
            'That does not look like a HelloFresh recipe link.'
          )
        );
      }

      setImporting(true);
      try {
        const result = await importFromUrl(url);
        setDraft(result.recipe);
        setWarnings(result.warnings);
        return { success: true, recipe: result.recipe, warnings: result.warnings };
      } catch (err) {
        return fail(err);
      } finally {
        setImporting(false);
      }
    },
    [fail]
  );

  /** The fallback when there is no card to photograph and no link to paste. */
  const startManualEntry = useCallback(() => {
    setError(null);
    setWarnings([]);
    setDraft(emptyDraft());
  }, []);

  const updateDraft = useCallback((patch) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  /** Write the reviewed recipe to the shared library. */
  const saveDraft = useCallback(
    async (candidate) => {
      const recipe = candidate ?? draft;
      if (!user?.uid) return fail(new HelloFreshImportError('unauthenticated', 'Sign in first.'));
      if (!recipe) return fail(new HelloFreshImportError('unknown', 'There is nothing to save.'));

      const problems = validateDraft(recipe);
      if (problems.length > 0) {
        const problem = { code: 'invalid-recipe', message: problems[0], details: problems };
        setError(problem);
        return { success: false, error: problem };
      }

      setSaving(true);
      setError(null);
      try {
        const ref = await addDoc(collection(db, 'recipes'), {
          ...toRecipeDocument(recipe),
          createdAt: serverTimestamp(),
        });
        return { success: true, id: ref.id };
      } catch (err) {
        console.error('Error saving HelloFresh recipe:', err);
        return fail(new HelloFreshImportError('save-failed', 'That recipe could not be saved.'));
      } finally {
        setSaving(false);
      }
    },
    [draft, fail, user?.uid]
  );

  return {
    configured,
    draft,
    warnings,
    importing,
    saving,
    error,
    importPhoto,
    importUrl,
    startManualEntry,
    updateDraft,
    saveDraft,
    reset,
  };
};

export default useHelloFreshImport;
