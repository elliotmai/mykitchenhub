// Matching recipes to food that is about to go off, and putting one on the
// meal plan. The ranking is the point: a recipe that rescues three things
// should beat one that rescues two.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useRecipeSuggestions, {
  MEAL_PLAN_SOURCE,
  ingredientMatchesItem,
  matchRecipesToItems,
  recipeTitle,
  todayIsoDate,
} from '../useRecipeSuggestions';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import {
  asDocs,
  makeItem,
  makeRecipe,
  daysFromNow,
  makeUserProfile,
} from '../../test-utils/factories';

const UID = 'test-uid';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const recipe = (name, ingredientNames, overrides = {}) =>
  makeRecipe({
    name,
    ingredients: ingredientNames.map((n) => ({ name: n, normalized: n, quantity: 1, unit: 'ea' })),
    ...overrides,
  });

const renderSuggestions = async (recipes, expiringItems) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));
  fs.getDocs.mockResolvedValue(fs.__querySnapshot(asDocs(recipes)));

  const view = renderHook(() => useRecipeSuggestions(expiringItems), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
};

// ---------------------------------------------------------------------------
// Pure matching
// ---------------------------------------------------------------------------

describe('ingredientMatchesItem', () => {
  it('matches the same ingredient written the same way', () => {
    expect(ingredientMatchesItem('spinach', 'spinach')).toBe(true);
  });

  it('matches a general pantry name against a specific recipe one', () => {
    expect(ingredientMatchesItem('chicken breast', 'chicken')).toBe(true);
    expect(ingredientMatchesItem('milk', 'whole milk')).toBe(true);
  });

  it('does not match unrelated food', () => {
    expect(ingredientMatchesItem('spinach', 'salmon')).toBe(false);
  });

  it('compares very short names strictly, so egg does not match eggplant', () => {
    expect(ingredientMatchesItem('egg', 'eggplant')).toBe(false);
    expect(ingredientMatchesItem('egg', 'egg')).toBe(true);
  });

  it('ignores case', () => {
    expect(ingredientMatchesItem('Spinach', 'spinach')).toBe(true);
    expect(ingredientMatchesItem('  SALMON ', 'Salmon')).toBe(true);
  });

  it.each([
    ['egg', 'eggs'],
    ['eggs', 'egg'],
    ['tomato', 'tomatoes'],
    ['berry', 'berries'],
    ['squash', 'squashes'],
    ['Onion', 'onions'],
  ])('matches %s against %s, which differ only by number', (a, b) => {
    // A recipe asks for "egg" and the fridge holds "Eggs". The length guard
    // that keeps "egg" away from "eggplant" also kept it away from "eggs", so
    // a carton about to go off matched nothing at all.
    expect(ingredientMatchesItem(a, b)).toBe(true);
  });

  it('does not let plural matching reopen the eggplant hole', () => {
    expect(ingredientMatchesItem('egg', 'eggplants')).toBe(false);
    expect(ingredientMatchesItem('eggs', 'eggplant')).toBe(false);
  });

  it('ignores case and surrounding spaces', () => {
    expect(ingredientMatchesItem('  Spinach ', 'SPINACH')).toBe(true);
  });

  it('treats a missing name as no match rather than throwing', () => {
    expect(ingredientMatchesItem(null, 'spinach')).toBe(false);
    expect(ingredientMatchesItem('spinach', undefined)).toBe(false);
  });
});

describe('matchRecipesToItems', () => {
  const spinach = makeItem({ name: 'Spinach', expiresAt: daysFromNow(1) });
  const salmon = makeItem({ name: 'Salmon', expiresAt: daysFromNow(3) });
  const milk = makeItem({ name: 'Milk', expiresAt: daysFromNow(4) });

  it('ranks by how many expiring items a recipe uses up', () => {
    const ranked = matchRecipesToItems(
      [
        recipe('Salmon Bake', ['salmon']),
        recipe('Green Smoothie', ['spinach', 'milk']),
        recipe('Everything Pie', ['spinach', 'salmon', 'milk']),
      ],
      [spinach, salmon, milk]
    );

    expect(ranked.map((m) => m.title)).toEqual(['Everything Pie', 'Green Smoothie', 'Salmon Bake']);
    expect(ranked[0].matchCount).toBe(3);
  });

  it('breaks a tie with whichever item expires soonest', () => {
    const ranked = matchRecipesToItems(
      [recipe('Milk Pudding', ['milk']), recipe('Creamed Spinach', ['spinach'])],
      [spinach, salmon, milk]
    );

    expect(ranked.map((m) => m.title)).toEqual(['Creamed Spinach', 'Milk Pudding']);
  });

  it('leaves out recipes that use none of it', () => {
    const ranked = matchRecipesToItems([recipe('Plain Toast', ['bread'])], [spinach]);
    expect(ranked).toEqual([]);
  });

  it('names the items each recipe would rescue', () => {
    const [match] = matchRecipesToItems(
      [recipe('Green Smoothie', ['spinach', 'milk'])],
      [spinach, salmon, milk]
    );

    expect(match.usesItems.map((i) => i.name)).toEqual(['Spinach', 'Milk']);
  });

  it('returns nothing when the recipe library is empty', () => {
    expect(matchRecipesToItems([], [makeItem({ name: 'Spinach' })])).toEqual([]);
  });

  it('returns nothing when there is nothing expiring', () => {
    expect(matchRecipesToItems([recipe('Anything', ['spinach'])], [])).toEqual([]);
  });

  it('returns nothing rather than throwing when handed no lists at all', () => {
    expect(matchRecipesToItems(undefined, undefined)).toEqual([]);
    expect(matchRecipesToItems(null, [])).toEqual([]);
  });

  it('skips a recipe whose ingredient list is empty', () => {
    expect(
      matchRecipesToItems([recipe('Boiled Water', [])], [makeItem({ name: 'Spinach' })])
    ).toEqual([]);
  });

  it('copes with a recipe whose ingredients are plain strings', () => {
    // Legacy imports store ingredients as free text rather than objects.
    const ranked = matchRecipesToItems(
      [makeRecipe({ name: 'Loose Notes', ingredients: ['spinach'] })],
      [spinach]
    );

    expect(ranked).toHaveLength(1);
  });

  it('skips a recipe with no ingredient list at all', () => {
    const ranked = matchRecipesToItems(
      [makeRecipe({ name: 'Mystery', ingredients: undefined })],
      [spinach]
    );
    expect(ranked).toEqual([]);
  });
});

describe('recipeTitle', () => {
  it('prefers the documented `name` field', () => {
    expect(recipeTitle({ name: 'Sheet Pan Salmon' })).toBe('Sheet Pan Salmon');
  });

  it('accepts a legacy `title` field', () => {
    expect(recipeTitle({ title: 'Old Import' })).toBe('Old Import');
  });

  it('never renders "undefined" at a cook', () => {
    expect(recipeTitle({})).toBe('Untitled recipe');
  });
});

describe('todayIsoDate', () => {
  it('uses the local calendar day, not UTC', () => {
    // 11pm on the 14th in a UTC-5 zone is still the 14th to the person cooking.
    const lateEvening = new Date(2026, 7, 14, 23, 30);
    expect(todayIsoDate(lateEvening)).toBe('2026-08-14');
  });
});

// ---------------------------------------------------------------------------
// Hook behaviour
// ---------------------------------------------------------------------------

describe('useRecipeSuggestions', () => {
  const spinach = makeItem({ id: 'item-1', name: 'Spinach', expiresAt: daysFromNow(1) });

  it('reads the shared recipe library and returns the matches', async () => {
    const { result } = await renderSuggestions(
      [recipe('Creamed Spinach', ['spinach']), recipe('Plain Toast', ['bread'])],
      [spinach]
    );

    // The shared library, not a per-user subcollection — that is what the
    // security rules grant every signed-in user.
    const queried = fs.query.mock.calls.map(([ref]) => fs.pathOf(ref));
    expect(queried).toContain('recipes');

    expect(result.current.suggestions.map((m) => m.title)).toEqual(['Creamed Spinach']);
  });

  it('does not query anything when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useRecipeSuggestions([spinach]), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.suggestions).toEqual([]);
    expect(fs.getDocs).not.toHaveBeenCalled();
  });

  it('reports a read failure instead of hanging on a spinner', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    authMock.__setUser(authMock.__user({ uid: UID }));
    fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));
    fs.getDocs.mockRejectedValueOnce(new Error('permission-denied'));

    const { result } = renderHook(() => useRecipeSuggestions([spinach]), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load recipe suggestions');
  });
});

describe('useRecipeSuggestions.addToMealPlan', () => {
  const spinach = makeItem({ id: 'item-1', name: 'Spinach', expiresAt: daysFromNow(1) });

  it("writes a mealPlanEntries document in Phase 7's shape", async () => {
    const { result } = await renderSuggestions([recipe('Creamed Spinach', ['spinach'])], [spinach]);

    let response;
    await act(async () => {
      response = await result.current.addToMealPlan(result.current.suggestions[0]);
    });

    expect(response).toEqual({ success: true });

    const [ref, payload] = fs.addDoc.mock.calls[0];
    // The collection Phase 7 owns and reads — not one of our own invention.
    expect(fs.pathOf(ref)).toBe(`users/${UID}/mealPlanEntries`);
    expect(payload).toMatchObject({
      recipeId: result.current.suggestions[0].recipe.id,
      recipeName: 'Creamed Spinach',
      mealType: 'dinner',
      servings: 2,
      status: 'planned',
      source: MEAL_PLAN_SOURCE,
      cookedAt: null,
      batchGroup: null,
      notes: '',
      planId: null,
    });
    expect(payload.createdAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('dates the entry as a YYYY-MM-DD string, never a Timestamp', async () => {
    // Phase 7's rules reject anything else, and its day cards key on the string.
    const { result } = await renderSuggestions([recipe('Creamed Spinach', ['spinach'])], [spinach]);

    await act(async () => {
      await result.current.addToMealPlan(result.current.suggestions[0]);
    });

    const payload = fs.addDoc.mock.calls[0][1];
    expect(typeof payload.date).toBe('string');
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tags the entry as waste prevention, so the meal plan can say why it is there', async () => {
    const { result } = await renderSuggestions([recipe('Creamed Spinach', ['spinach'])], [spinach]);

    await act(async () => {
      await result.current.addToMealPlan(result.current.suggestions[0]);
    });

    expect(fs.addDoc.mock.calls[0][1].source).toBe('waste-prevention');
  });

  it('records the expiring food the meal is meant to use up', async () => {
    // Phase 7's "Mark as Cooked" decrements inventory from this list, so it
    // carries the normalized name and a quantity, not just a label.
    const { result } = await renderSuggestions([recipe('Creamed Spinach', ['spinach'])], [spinach]);

    await act(async () => {
      await result.current.addToMealPlan(result.current.suggestions[0]);
    });

    expect(fs.addDoc.mock.calls[0][1].usesIngredients).toEqual([
      { name: 'Spinach', normalized: 'spinach', quantity: 1, unit: 'gal' },
    ]);
  });

  it('accepts a chosen day and meal', async () => {
    const { result } = await renderSuggestions([recipe('Creamed Spinach', ['spinach'])], [spinach]);

    await act(async () => {
      await result.current.addToMealPlan(result.current.suggestions[0], {
        date: '2026-08-20',
        mealType: 'lunch',
        servings: 4,
      });
    });

    expect(fs.addDoc.mock.calls[0][1]).toMatchObject({
      date: '2026-08-20',
      mealType: 'lunch',
      servings: 4,
    });
  });

  it('refuses to write when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useRecipeSuggestions([spinach]), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => {
      response = await result.current.addToMealPlan({ recipe: { id: 'r1' } });
    });

    expect(response).toEqual({ success: false, error: 'Not authenticated' });
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('reports the failure rather than throwing when Firestore rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderSuggestions([recipe('Creamed Spinach', ['spinach'])], [spinach]);
    fs.addDoc.mockRejectedValueOnce(new Error('quota exceeded'));

    let response;
    await act(async () => {
      response = await result.current.addToMealPlan(result.current.suggestions[0]);
    });

    expect(response).toEqual({ success: false, error: 'quota exceeded' });
  });
});
