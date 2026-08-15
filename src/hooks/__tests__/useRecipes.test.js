// Covers the recipe hook: the pure search/filter/sort helpers that drive the
// library UI, and the Firestore-backed CRUD surface — including the two rules
// that bite hardest, `name` being immutable and only user-created recipes
// being deletable.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useRecipes, {
  RECIPE_SOURCES,
  DIFFICULTIES,
  normalizeName,
  toMillis,
  totalTime,
  instructionSteps,
  collectTags,
  matchesSearch,
  filterRecipes,
  sortRecipes,
  buildRecipeDocument,
  validateRecipe,
  validateRecipePatch,
} from '../useRecipes';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeRecipe, makeUserProfile, daysFromNow } from '../../test-utils/factories';

const UID = 'test-uid';
const RECIPES_PATH = 'recipes';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

/** Render the hook signed in, with the first snapshot already delivered. */
const renderRecipes = async (recipes = []) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useRecipes(), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(RECIPES_PATH, asDocs(recipes));
  });
  return view;
};

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

describe('recipe contract constants', () => {
  it('lists exactly the sources firestore.rules allows', () => {
    expect(RECIPE_SOURCES).toEqual([
      'legacy',
      'spoonacular',
      'ai-generated',
      'user-created',
      'hellofresh',
    ]);
  });

  it('lists exactly the difficulties firestore.rules allows', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'medium', 'hard']);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('normalizeName', () => {
  it('lowercases and collapses whitespace, matching the inventory key', () => {
    expect(normalizeName('  Chicken   BREAST ')).toBe('chicken breast');
  });

  it('copes with nothing', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('toMillis', () => {
  it('reads a Firestore Timestamp', () => {
    const ts = daysFromNow(-1);
    expect(toMillis(ts)).toBe(ts.toMillis());
  });

  it('reads an ISO string', () => {
    expect(toMillis('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('treats a missing or unreadable date as the beginning of time', () => {
    expect(toMillis(null)).toBe(0);
    expect(toMillis('not a date')).toBe(0);
  });
});

describe('totalTime', () => {
  it('adds prep and cook time', () => {
    expect(totalTime({ prepTime: 10, cookTime: 15 })).toBe(25);
  });

  it('works when only one is recorded', () => {
    expect(totalTime({ cookTime: 20 })).toBe(20);
  });

  it('returns null when the recipe has no timings, rather than a misleading 0', () => {
    expect(totalTime({})).toBeNull();
    expect(totalTime({ prepTime: null, cookTime: null })).toBeNull();
  });
});

describe('instructionSteps', () => {
  it('passes an array of steps through', () => {
    expect(instructionSteps(['One.', 'Two.'])).toEqual(['One.', 'Two.']);
  });

  it('splits a blob of text — legacy recipes arrive that way', () => {
    expect(instructionSteps('One.\n\nTwo.')).toEqual(['One.', 'Two.']);
  });

  it('drops blank steps', () => {
    expect(instructionSteps(['One.', '   ', 'Two.'])).toEqual(['One.', 'Two.']);
  });

  it('returns nothing for a recipe with no instructions', () => {
    expect(instructionSteps(undefined)).toEqual([]);
  });
});

describe('collectTags', () => {
  it('gathers every tag once, alphabetically', () => {
    const tags = collectTags([
      makeRecipe({ tags: ['dinner', 'quick'] }),
      makeRecipe({ tags: ['quick', 'vegetarian'] }),
    ]);

    expect(tags).toEqual(['dinner', 'quick', 'vegetarian']);
  });

  it('handles recipes with no tags at all', () => {
    expect(collectTags([makeRecipe({ tags: undefined })])).toEqual([]);
  });
});

describe('matchesSearch', () => {
  const recipe = makeRecipe({
    name: 'Sheet Pan Salmon',
    tags: ['dinner', 'quick'],
    ingredients: [{ name: 'salmon', quantity: 2, unit: 'fillet', normalized: 'salmon' }],
  });

  it('matches on the recipe name', () => {
    expect(matchesSearch(recipe, 'salmon')).toBe(true);
    expect(matchesSearch(recipe, 'SHEET')).toBe(true);
  });

  it('matches on a tag', () => {
    expect(matchesSearch(recipe, 'quick')).toBe(true);
  });

  it('matches on an ingredient — "what can I cook with this?"', () => {
    const stirFry = makeRecipe({
      name: 'Stir Fry',
      tags: [],
      ingredients: [{ name: 'soy sauce', normalized: 'soy sauce' }],
    });

    expect(matchesSearch(stirFry, 'soy')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesSearch(recipe, 'lasagne')).toBe(false);
  });

  it('matches everything when the search is empty', () => {
    expect(matchesSearch(recipe, '')).toBe(true);
    expect(matchesSearch(recipe, '   ')).toBe(true);
  });
});

describe('filterRecipes', () => {
  const library = [
    makeRecipe({
      id: 'a',
      name: 'Quick Pasta',
      tags: ['dinner', 'quick'],
      source: 'user-created',
      difficulty: 'easy',
      prepTime: 5,
      cookTime: 10,
    }),
    makeRecipe({
      id: 'b',
      name: 'Slow Stew',
      tags: ['dinner'],
      source: 'legacy',
      difficulty: 'hard',
      prepTime: 20,
      cookTime: 160,
    }),
    makeRecipe({
      id: 'c',
      name: 'Timeless Toast',
      tags: ['breakfast'],
      source: 'hellofresh',
      difficulty: 'easy',
      prepTime: null,
      cookTime: null,
    }),
  ];

  it('filters by source', () => {
    expect(filterRecipes(library, { source: 'legacy' }).map((r) => r.id)).toEqual(['b']);
  });

  it('filters by difficulty', () => {
    expect(filterRecipes(library, { difficulty: 'easy' }).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('requires every selected tag, not just one', () => {
    expect(filterRecipes(library, { tags: ['dinner', 'quick'] }).map((r) => r.id)).toEqual(['a']);
    expect(filterRecipes(library, { tags: ['dinner'] }).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('filters by how long the recipe takes', () => {
    expect(filterRecipes(library, { maxMinutes: 30 }).map((r) => r.id)).toEqual(['a']);
  });

  it('excludes untimed recipes from a time filter — they cannot be promised to fit', () => {
    expect(filterRecipes(library, { maxMinutes: 300 }).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('combines filters', () => {
    expect(
      filterRecipes(library, { search: 'pasta', tags: ['dinner'], difficulty: 'easy' }).map(
        (r) => r.id
      )
    ).toEqual(['a']);
  });

  it('returns everything when nothing is selected', () => {
    expect(filterRecipes(library, {})).toHaveLength(3);
  });
});

describe('sortRecipes', () => {
  const library = [
    makeRecipe({
      id: 'a',
      name: 'Beta',
      createdAt: daysFromNow(-5),
      timesCooked: 2,
      prepTime: 10,
      cookTime: 50,
    }),
    makeRecipe({
      id: 'b',
      name: 'Alpha',
      createdAt: daysFromNow(-1),
      timesCooked: 9,
      prepTime: 5,
      cookTime: 5,
    }),
  ];

  it('puts the newest first by default', () => {
    expect(sortRecipes(library).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('sorts alphabetically', () => {
    expect(sortRecipes(library, 'name').map((r) => r.name)).toEqual(['Alpha', 'Beta']);
  });

  it('sorts by how often each has been cooked', () => {
    expect(sortRecipes(library, 'timesCooked').map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('sorts quickest first, leaving untimed recipes last', () => {
    const withUntimed = [...library, makeRecipe({ id: 'c', prepTime: null, cookTime: null })];
    expect(sortRecipes(withUntimed, 'time').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not mutate the array it was given', () => {
    const original = [...library];
    sortRecipes(library, 'name');
    expect(library).toEqual(original);
  });
});

describe('buildRecipeDocument', () => {
  const form = {
    name: '  Sheet Pan Salmon  ',
    ingredients: [{ name: '  Salmon ', quantity: '2', unit: 'fillet' }],
    instructions: ['Roast for 15 minutes.'],
    tags: ['Dinner', 'dinner', ' Quick '],
    servings: '2',
    difficulty: 'easy',
    prepTime: '5',
    cookTime: '15',
  };

  it('produces every field the rules require on create', () => {
    const doc = buildRecipeDocument(form);

    [
      'name',
      'ingredients',
      'instructions',
      'source',
      'tags',
      'servings',
      'difficulty',
      'timesCooked',
    ].forEach((field) => expect(doc).toHaveProperty(field));
  });

  it('trims the name and normalizes each ingredient', () => {
    const doc = buildRecipeDocument(form);

    expect(doc.name).toBe('Sheet Pan Salmon');
    expect(doc.ingredients[0]).toEqual({
      name: 'Salmon',
      quantity: 2,
      unit: 'fillet',
      normalized: 'salmon',
    });
  });

  it('de-duplicates and normalizes tags', () => {
    expect(buildRecipeDocument(form).tags).toEqual(['dinner', 'quick']);
  });

  it('defaults a new recipe to user-created and zero cooks', () => {
    const doc = buildRecipeDocument(form);

    expect(doc.source).toBe('user-created');
    expect(doc.timesCooked).toBe(0);
  });

  it('carries a different source through when one is given', () => {
    expect(buildRecipeDocument(form, 'hellofresh').source).toBe('hellofresh');
  });

  it('never writes a serving count the rules would reject', () => {
    expect(buildRecipeDocument({ ...form, servings: 0 }).servings).toBe(1);
    expect(buildRecipeDocument({ ...form, servings: '' }).servings).toBe(1);
  });

  it('falls back to a valid difficulty', () => {
    expect(buildRecipeDocument({ ...form, difficulty: 'impossible' }).difficulty).toBe('easy');
  });

  it('records a blank timing as null rather than a fictitious zero', () => {
    const doc = buildRecipeDocument({ ...form, prepTime: '', cookTime: '' });

    expect(doc.prepTime).toBeNull();
    expect(doc.cookTime).toBeNull();
  });

  it('drops ingredient rows the cook left empty', () => {
    const doc = buildRecipeDocument({
      ...form,
      ingredients: [{ name: 'Salmon' }, { name: '  ' }, {}],
    });

    expect(doc.ingredients).toHaveLength(1);
  });
});

describe('validateRecipe', () => {
  const valid = {
    name: 'Toast',
    ingredients: [{ name: 'bread' }],
    instructions: ['Toast the bread.'],
    servings: 1,
    difficulty: 'easy',
  };

  it('accepts a complete recipe', () => {
    expect(validateRecipe(valid)).toBeNull();
  });

  it.each([
    ['a blank name', { name: '  ' }, /name is required/i],
    ['no ingredients', { ingredients: [] }, /at least one ingredient/i],
    ['no instructions', { instructions: [] }, /at least one instruction/i],
    ['zero servings', { servings: 0 }, /greater than 0/i],
    ['an invalid difficulty', { difficulty: 'brutal' }, /easy, medium, or hard/i],
  ])('rejects %s', (_label, patch, message) => {
    expect(validateRecipe({ ...valid, ...patch })).toMatch(message);
  });
});

describe('validateRecipePatch', () => {
  it('only checks the fields being changed', () => {
    // No ingredients in the patch, so their absence is not an error.
    expect(validateRecipePatch({ servings: 4 })).toBeNull();
  });

  it('rejects an edit that would empty the ingredients', () => {
    expect(validateRecipePatch({ ingredients: [] })).toMatch(/at least one ingredient/i);
  });

  it('rejects an edit that would empty the instructions', () => {
    expect(validateRecipePatch({ instructions: [] })).toMatch(/at least one instruction/i);
  });

  it('accepts an empty patch', () => {
    expect(validateRecipePatch({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hook behaviour
// ---------------------------------------------------------------------------

describe('useRecipes subscription', () => {
  it('subscribes to the shared library and exposes the documents', async () => {
    const { result } = await renderRecipes([
      makeRecipe({ id: 'a', name: 'Pasta' }),
      makeRecipe({ id: 'b', name: 'Stew' }),
    ]);

    expect(result.current.recipes).toHaveLength(2);
    expect(result.current.recipes.map((r) => r.name)).toEqual(['Pasta', 'Stew']);
    expect(result.current.loading).toBe(false);
  });

  it('orders by creation date, newest first', async () => {
    await renderRecipes([]);
    expect(fs.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('reads the shared collection, not a per-user one', async () => {
    await renderRecipes([]);
    expect(fs.pathOf(fs.onSnapshot.mock.calls[0][0])).toBe('recipes');
  });

  it('does not subscribe when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useRecipes(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recipes).toEqual([]);
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  it('surfaces a listener failure instead of hanging', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderRecipes([]);

    await act(async () => {
      fs.__emitError(RECIPES_PATH, new Error('permission-denied'));
    });

    expect(result.current.error).toBe('Failed to load recipes');
    expect(result.current.loading).toBe(false);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderRecipes([]);
    expect(fs.__listenerCount(RECIPES_PATH)).toBe(1);

    unmount();
    expect(fs.__listenerCount(RECIPES_PATH)).toBe(0);
  });

  it('exposes the tags across the library for the filter bar', async () => {
    const { result } = await renderRecipes([
      makeRecipe({ tags: ['dinner'] }),
      makeRecipe({ tags: ['quick'] }),
    ]);

    expect(result.current.tags).toEqual(['dinner', 'quick']);
  });
});

describe('useRecipes.addRecipe', () => {
  const input = {
    name: 'Sheet Pan Salmon',
    ingredients: [{ name: 'Salmon', quantity: 2, unit: 'fillet' }],
    instructions: ['Roast for 15 minutes.'],
    servings: 2,
    difficulty: 'easy',
    tags: ['dinner'],
  };

  it('writes a contract-shaped document to the shared collection', async () => {
    const { result } = await renderRecipes([]);

    let response;
    await act(async () => {
      response = await result.current.addRecipe(input);
    });

    expect(response.success).toBe(true);
    const [ref, payload] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe('recipes');
    expect(payload.name).toBe('Sheet Pan Salmon');
    expect(payload.source).toBe('user-created');
    expect(payload.timesCooked).toBe(0);
    expect(payload.difficulty).toBe('easy');
    expect(payload.createdAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('records who added it', async () => {
    const { result } = await renderRecipes([]);

    await act(async () => {
      await result.current.addRecipe(input);
    });

    expect(fs.addDoc.mock.calls[0][1].createdBy).toBe(UID);
  });

  it.each([
    ['a blank name', { name: '  ' }, /name is required/i],
    ['no ingredients', { ingredients: [] }, /at least one ingredient/i],
    ['no instructions', { instructions: [] }, /at least one instruction/i],
  ])('rejects %s without writing', async (_label, patch, message) => {
    const { result } = await renderRecipes([]);

    let response;
    await act(async () => {
      response = await result.current.addRecipe({ ...input, ...patch });
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(message);
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('refuses to write when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useRecipes(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.addRecipe(input);
    });

    expect(response).toEqual({ success: false, error: 'Not authenticated' });
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('reports the failure rather than throwing when Firestore rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderRecipes([]);
    fs.addDoc.mockRejectedValueOnce(new Error('permission-denied'));

    let response;
    await act(async () => {
      response = await result.current.addRecipe(input);
    });

    expect(response).toEqual({ success: false, error: 'permission-denied' });
  });
});

describe('useRecipes.updateRecipe', () => {
  it('patches the addressed document and stamps updatedAt', async () => {
    const { result } = await renderRecipes([makeRecipe({ id: 'r1' })]);

    await act(async () => {
      await result.current.updateRecipe('r1', { servings: 6 });
    });

    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe('recipes/r1');
    expect(patch.servings).toBe(6);
    expect(patch.updatedAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  // The rules compare `name` and `createdAt` against the stored document, so an
  // update carrying either fails outright — even when the value is unchanged.
  it('never sends the immutable fields, even when asked to', async () => {
    const { result } = await renderRecipes([makeRecipe({ id: 'r1', name: 'Original' })]);

    await act(async () => {
      await result.current.updateRecipe('r1', {
        name: 'Renamed',
        createdAt: 'yesterday',
        source: 'legacy',
        servings: 3,
      });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    expect(patch).not.toHaveProperty('name');
    expect(patch).not.toHaveProperty('createdAt');
    expect(patch).not.toHaveProperty('source');
    expect(patch.servings).toBe(3);
  });

  it('normalizes edited ingredients the same way a create does', async () => {
    const { result } = await renderRecipes([makeRecipe({ id: 'r1' })]);

    await act(async () => {
      await result.current.updateRecipe('r1', {
        ingredients: [{ name: '  Chicken Breast ', quantity: '1', unit: 'lb' }],
      });
    });

    const [, patch] = fs.updateDoc.mock.calls[0];
    expect(patch.ingredients[0]).toEqual({
      name: 'Chicken Breast',
      quantity: 1,
      unit: 'lb',
      normalized: 'chicken breast',
    });
  });

  it('rejects an edit that would leave the recipe uncookable', async () => {
    const { result } = await renderRecipes([makeRecipe({ id: 'r1' })]);

    let response;
    await act(async () => {
      response = await result.current.updateRecipe('r1', { instructions: [] });
    });

    expect(response.success).toBe(false);
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('refuses to write when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useRecipes(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.updateRecipe('r1', { servings: 2 });
    });

    expect(response).toEqual({ success: false, error: 'Not authenticated' });
  });
});

describe('useRecipes.deleteRecipe', () => {
  it('deletes a recipe the user created', async () => {
    const { result } = await renderRecipes([makeRecipe({ id: 'r1', source: 'user-created' })]);

    let response;
    await act(async () => {
      response = await result.current.deleteRecipe('r1');
    });

    expect(response.success).toBe(true);
    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe('recipes/r1');
  });

  // The rules only allow deleting `source: 'user-created'`. Saying so up front
  // beats letting the write bounce with an opaque permission error.
  it.each(['legacy', 'spoonacular', 'hellofresh', 'ai-generated'])(
    'refuses to delete a %s recipe, and explains why',
    async (source) => {
      const { result } = await renderRecipes([makeRecipe({ id: 'r1', source })]);

      let response;
      await act(async () => {
        response = await result.current.deleteRecipe('r1');
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/added yourself/i);
      expect(fs.deleteDoc).not.toHaveBeenCalled();
    }
  );

  it('reports the failure rather than throwing when Firestore rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderRecipes([makeRecipe({ id: 'r1', source: 'user-created' })]);
    fs.deleteDoc.mockRejectedValueOnce(new Error('offline'));

    let response;
    await act(async () => {
      response = await result.current.deleteRecipe('r1');
    });

    expect(response).toEqual({ success: false, error: 'offline' });
  });
});

describe('useRecipes.markCooked', () => {
  it('increments the cook count instead of writing a computed value', async () => {
    const { result } = await renderRecipes([makeRecipe({ id: 'r1', timesCooked: 3 })]);

    await act(async () => {
      await result.current.markCooked('r1');
    });

    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe('recipes/r1');
    expect(patch.timesCooked).toEqual({ __sentinel: 'increment', by: 1 });
    expect(patch.lastCookedAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('works on a recipe the user did not create — anyone may record a cook', async () => {
    const { result } = await renderRecipes([makeRecipe({ id: 'r1', source: 'legacy' })]);

    let response;
    await act(async () => {
      response = await result.current.markCooked('r1');
    });

    expect(response.success).toBe(true);
  });

  it('reports the failure rather than throwing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderRecipes([makeRecipe({ id: 'r1' })]);
    fs.updateDoc.mockRejectedValueOnce(new Error('offline'));

    let response;
    await act(async () => {
      response = await result.current.markCooked('r1');
    });

    expect(response).toEqual({ success: false, error: 'offline' });
  });
});

describe('useRecipes selectors', () => {
  it('finds a recipe by id', async () => {
    const { result } = await renderRecipes([makeRecipe({ id: 'r1', name: 'Pasta' })]);

    expect(result.current.getRecipeById('r1').name).toBe('Pasta');
    expect(result.current.getRecipeById('nope')).toBeNull();
  });

  it('searches the loaded library', async () => {
    const { result } = await renderRecipes([
      makeRecipe({ id: 'r1', name: 'Pasta' }),
      makeRecipe({ id: 'r2', name: 'Stew' }),
    ]);

    expect(result.current.search('pasta').map((r) => r.id)).toEqual(['r1']);
  });
});
