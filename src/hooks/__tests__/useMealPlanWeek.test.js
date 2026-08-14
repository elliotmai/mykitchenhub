// Meal planning is built by another roadmap phase. The dashboard has to read
// its collection today anyway, so these cover the three ways there can be
// nothing to show — absent, empty, or for a different week — alongside the
// happy path.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useMealPlanWeek, { normalizeMeals, dayLabel, weekRangeLabel } from '../useMealPlanWeek';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeMealPlan, makeUserProfile, daysFromNow } from '../../test-utils/factories';

const UID = 'test-uid';
const PLANS_PATH = `users/${UID}/mealPlans`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

/** Render the hook signed in, with the first snapshot already delivered. */
const renderPlans = async (plans = []) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useMealPlanWeek(), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(PLANS_PATH, asDocs(plans));
  });
  return view;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('dayLabel', () => {
  it('shortens the days of the week', () => {
    expect(dayLabel('monday')).toBe('Mon');
    expect(dayLabel('SUNDAY')).toBe('Sun');
  });

  it('title-cases anything it does not recognise', () => {
    expect(dayLabel('leftovers')).toBe('Leftovers');
  });

  it.each([[''], [null], [undefined], [42]])('returns an empty string for %p', (value) => {
    expect(dayLabel(value)).toBe('');
  });
});

describe('normalizeMeals', () => {
  it('returns an empty list when there is no plan at all', () => {
    expect(normalizeMeals(null)).toEqual([]);
    expect(normalizeMeals({})).toEqual([]);
    expect(normalizeMeals({ meals: 'friday' })).toEqual([]);
  });

  it('orders meals by the day they are cooked, not the order they were written', () => {
    const meals = normalizeMeals({
      meals: [
        { day: 'friday', recipeName: 'Pizza' },
        { day: 'monday', recipeName: 'Salmon' },
        { day: 'wednesday', recipeName: 'Chili' },
      ],
    });

    expect(meals.map((m) => m.title)).toEqual(['Salmon', 'Chili', 'Pizza']);
  });

  it('accepts `name` as well as `recipeName`', () => {
    expect(normalizeMeals({ meals: [{ day: 'monday', name: 'Soup' }] })[0].title).toBe('Soup');
  });

  it('sorts an unrecognised day to the end instead of the front of the week', () => {
    const meals = normalizeMeals({
      meals: [
        { day: 'someday', recipeName: 'Leftovers' },
        { day: 'tuesday', recipeName: 'Tacos' },
      ],
    });

    expect(meals.map((m) => m.title)).toEqual(['Tacos', 'Leftovers']);
  });

  it('drops entries that name neither a day nor a recipe', () => {
    expect(normalizeMeals({ meals: [{ servings: 2 }, {}, null] })).toEqual([]);
  });

  it('keeps a meal with a day but no recipe, so the gap is visible', () => {
    const meals = normalizeMeals({ meals: [{ day: 'monday' }] });
    expect(meals).toHaveLength(1);
    expect(meals[0].title).toBe('');
  });

  it('reads servings only when it is a number', () => {
    const [a, b] = normalizeMeals({
      meals: [
        { day: 'monday', recipeName: 'A', servings: 4 },
        { day: 'tuesday', recipeName: 'B', servings: 'four' },
      ],
    });
    expect(a.servings).toBe(4);
    expect(b.servings).toBeNull();
  });
});

describe('weekRangeLabel', () => {
  it('spans Monday to Sunday of the given week', () => {
    expect(weekRangeLabel(new Date('2026-08-14T12:00:00'))).toBe('Aug 10 – Aug 16');
  });
});

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

describe('useMealPlanWeek', () => {
  it("subscribes to the current user's meal plans, newest first", async () => {
    await renderPlans([]);

    expect(fs.pathOf(fs.onSnapshot.mock.calls[0][0])).toBe(PLANS_PATH);
    expect(fs.orderBy).toHaveBeenCalledWith('weekOf', 'desc');
    expect(fs.limit).toHaveBeenCalledWith(5);
  });

  it("surfaces this week's plan and its meals", async () => {
    const { result } = await renderPlans([makeMealPlan()]);

    expect(result.current.mealCount).toBe(2);
    expect(result.current.meals.map((m) => m.title)).toEqual([
      'Sheet Pan Salmon',
      'Chicken Stir Fry',
    ]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('shows nothing when the collection is empty', async () => {
    const { result } = await renderPlans([]);

    expect(result.current.plan).toBeNull();
    expect(result.current.meals).toEqual([]);
    expect(result.current.mealCount).toBe(0);
  });

  it('ignores a plan for a different week rather than showing stale dinners', async () => {
    const { result } = await renderPlans([makeMealPlan({ weekOf: daysFromNow(-30) })]);

    expect(result.current.plan).toBeNull();
    expect(result.current.mealCount).toBe(0);
  });

  it('picks this week out of a run of recent plans', async () => {
    const { result } = await renderPlans([
      makeMealPlan({ weekOf: daysFromNow(-14), meals: [{ day: 'monday', recipeName: 'Old' }] }),
      makeMealPlan({ meals: [{ day: 'tuesday', recipeName: 'Current' }] }),
      makeMealPlan({ weekOf: daysFromNow(-21), meals: [] }),
    ]);

    expect(result.current.meals.map((m) => m.title)).toEqual(['Current']);
  });

  it('renders an empty week rather than an error when the collection is unreadable', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    authMock.__setUser(authMock.__user({ uid: UID }));
    fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

    const { result } = renderHook(() => useMealPlanWeek(), { wrapper });
    await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
    await act(async () => {
      fs.__emitError(PLANS_PATH, new Error('permission-denied'));
    });

    expect(result.current.meals).toEqual([]);
    expect(result.current.mealCount).toBe(0);
    expect(result.current.error).toBe('Failed to load meal plan');
    expect(result.current.loading).toBe(false);
  });

  it('does not subscribe when signed out', async () => {
    authMock.__setUser(null);

    const { result } = renderHook(() => useMealPlanWeek(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fs.__listenerCount(PLANS_PATH)).toBe(0);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderPlans([makeMealPlan()]);
    expect(fs.__listenerCount(PLANS_PATH)).toBe(1);

    unmount();

    expect(fs.__listenerCount(PLANS_PATH)).toBe(0);
  });
});
