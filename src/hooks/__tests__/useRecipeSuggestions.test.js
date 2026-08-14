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

  it('writes a meal plan entry in the documented shape', async () => {
    const { result } = await renderSuggestions([recipe('Creamed Spinach', ['spinach'])], [spinach]);

    let response;
    await act(async () => {
      response = await result.current.addToMealPlan(result.current.suggestions[0]);
    });

    expect(response).toEqual({ success: true });

    const [ref, payload] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`users/${UID}/mealPlan`);
    expect(payload).toMatchObject({
      recipeName: 'Creamed Spinach',
      mealType: 'dinner',
      status: 'planned',
      source: MEAL_PLAN_SOURCE,
      usesExpiringItems: ['spinach'],
    });
    expect(payload.plannedFor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.createdAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('accepts a chosen day and meal', async () => {
    const { result } = await renderSuggestions([recipe('Creamed Spinach', ['spinach'])], [spinach]);

    await act(async () => {
      await result.current.addToMealPlan(result.current.suggestions[0], {
        plannedFor: '2026-08-20',
        mealType: 'lunch',
        servings: 4,
      });
    });

    expect(fs.addDoc.mock.calls[0][1]).toMatchObject({
      plannedFor: '2026-08-20',
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
