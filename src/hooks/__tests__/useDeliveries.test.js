// useDeliveries — the Add Delivery workflow.
//
// The important assertions are about *where* each write goes and *what shape*
// it has, because a delivery fans out into four collections at once and the
// security rules police every one of them.

import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import useDeliveries, {
  addDays,
  cookDayOffset,
  mergeIngredients,
  toDateKey,
  weekOf,
} from '../useDeliveries';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import {
  asDocs,
  makeDelivery,
  makeHelloFreshRecipe,
  makeMealPlanEntry,
  makeUserProfile,
} from '../../test-utils/factories';
import { expectHumanError } from '../../test-utils/humanErrors';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

let uid;

const signIn = () => {
  const user = authMock.__user();
  authMock.__setUser(user);
  fs.getDoc.mockResolvedValue(fs.__doc(user.uid, makeUserProfile()));
  return user.uid;
};

const fridge = { id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' };

/** Writes recorded at a given collection path. */
const writesTo = (path) =>
  fs.addDoc.mock.calls.filter(([ref]) => fs.pathOf(ref) === path).map(([, data]) => data);

const renderDeliveries = () => renderHook(() => useDeliveries(), { wrapper });

beforeEach(() => {
  uid = signIn();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('date helpers', () => {
  it('formats a local date key without slipping a day in western timezones', () => {
    // 1 Jan 2026 00:30 local would be 31 Dec in UTC.
    expect(toDateKey(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });

  it('adds days without mutating the original', () => {
    const start = new Date(2026, 7, 14);
    expect(toDateKey(addDays(start, 3))).toBe('2026-08-17');
    expect(toDateKey(start)).toBe('2026-08-14');
  });

  it('rolls over a month boundary', () => {
    expect(toDateKey(addDays(new Date(2026, 7, 30), 4))).toBe('2026-09-03');
  });

  it('finds the Monday of the delivery week', () => {
    // 2026-08-14 is a Friday.
    expect(weekOf(new Date(2026, 7, 14))).toBe('2026-08-10');
    // Sunday belongs to the week that started the Monday before it.
    expect(weekOf(new Date(2026, 7, 16))).toBe('2026-08-10');
    expect(weekOf(new Date(2026, 7, 17))).toBe('2026-08-17');
  });

  it('spaces cook days as 1, 3, 5', () => {
    expect([0, 1, 2].map(cookDayOffset)).toEqual([0, 2, 4]);
  });
});

describe('mergeIngredients', () => {
  it('combines the same ingredient across two recipes into one line', () => {
    const merged = mergeIngredients([
      { ingredients: [{ name: 'Garlic', quantity: 2, unit: 'clove', normalized: 'garlic' }] },
      { ingredients: [{ name: 'Garlic', quantity: 1, unit: 'clove', normalized: 'garlic' }] },
    ]);

    expect(merged).toEqual([{ name: 'Garlic', normalized: 'garlic', unit: 'clove', quantity: 3 }]);
  });

  it('keeps different units apart — 2 cloves plus 1 tbsp is not 3 of anything', () => {
    const merged = mergeIngredients([
      {
        ingredients: [
          { name: 'Garlic', quantity: 2, unit: 'clove', normalized: 'garlic' },
          { name: 'Garlic paste', quantity: 1, unit: 'tbsp', normalized: 'garlic' },
        ],
      },
    ]);

    expect(merged).toHaveLength(2);
  });

  it('never produces a quantity the inventory rules reject', () => {
    const merged = mergeIngredients([
      { ingredients: [{ name: 'Salt', quantity: 0, unit: 'tsp', normalized: 'salt' }] },
    ]);

    expect(merged[0].quantity).toBeGreaterThan(0);
  });

  it('skips nameless entries and copes with missing ingredient lists', () => {
    expect(mergeIngredients([{ ingredients: [{ name: '  ' }] }, {}, null])).toEqual([]);
    expect(mergeIngredients(undefined)).toEqual([]);
  });

  it('falls back to the display name when there is no normalized field', () => {
    expect(mergeIngredients([{ ingredients: [{ name: 'Lime', quantity: 1, unit: '' }] }])).toEqual([
      { name: 'Lime', normalized: 'lime', unit: '', quantity: 1 },
    ]);
  });
});

describe('listening to delivery history', () => {
  it("subscribes to the signed-in user's deliveries", async () => {
    const { result } = renderDeliveries();

    await act(async () => {
      fs.__emit(`users/${uid}/deliveries`, asDocs([makeDelivery({ id: 'delivery-1' })]));
    });

    expect(result.current.deliveries).toHaveLength(1);
    expect(result.current.deliveries[0].id).toBe('delivery-1');
    expect(result.current.loading).toBe(false);
  });

  it('orders newest first, which is how the history reads', () => {
    renderDeliveries();
    expect(fs.orderBy).toHaveBeenCalledWith('deliveredAt', 'desc');
  });

  it('reports a listener failure instead of showing an empty kitchen', async () => {
    const { result } = renderDeliveries();

    await act(async () => {
      fs.__emitError(`users/${uid}/deliveries`);
    });

    expectHumanError(result.current.error, /delivery history/i);
    expect(result.current.loading).toBe(false);
  });

  it('drops the listener on unmount', async () => {
    const { unmount } = renderDeliveries();
    await waitFor(() => expect(fs.__listenerCount(`users/${uid}/deliveries`)).toBe(1));

    unmount();
    expect(fs.__listenerCount(`users/${uid}/deliveries`)).toBe(0);
  });

  it("shows nothing rather than someone else's kitchen when signed out", async () => {
    authMock.__setUser(null);
    const { result } = renderDeliveries();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.deliveries).toEqual([]);
  });
});

describe('addDelivery', () => {
  const recipes = [
    makeHelloFreshRecipe({
      id: 'r1',
      name: 'Sweet Chili Chicken',
      ingredients: [
        { name: 'Chicken Breast', quantity: 2, unit: 'unit', normalized: 'chicken breast' },
        { name: 'Garlic', quantity: 2, unit: 'clove', normalized: 'garlic' },
      ],
    }),
    makeHelloFreshRecipe({
      id: 'r2',
      name: 'Sheet Pan Salmon',
      ingredients: [
        { name: 'Salmon', quantity: 2, unit: 'fillet', normalized: 'salmon' },
        { name: 'Garlic', quantity: 1, unit: 'clove', normalized: 'garlic' },
      ],
    }),
    makeHelloFreshRecipe({
      id: 'r3',
      name: 'Veggie Tacos',
      ingredients: [{ name: 'Tortillas', quantity: 6, unit: 'unit', normalized: 'tortillas' }],
    }),
  ];

  // Garlic is in two of the three recipes, so five ingredient lines merge to four.
  const MERGED_ITEM_COUNT = 4;

  const deliveredAt = new Date(2026, 7, 14); // Friday

  const add = async (overrides = {}) => {
    const { result } = renderDeliveries();
    let outcome;
    await act(async () => {
      outcome = await result.current.addDelivery({
        recipes,
        deliveredAt,
        location: fridge,
        ...overrides,
      });
    });
    return { outcome, result };
  };

  it('reports what it did', async () => {
    const { outcome } = await add();

    expect(outcome.success).toBe(true);
    expect(outcome.mealsScheduled).toBe(3);
    // Garlic appears in two recipes but becomes one fridge item.
    expect(outcome.itemsAdded).toBe(MERGED_ITEM_COUNT);
  });

  it('records the delivery in the shape the rules require', async () => {
    await add();

    const [delivery] = writesTo(`users/${uid}/deliveries`);

    expect(delivery).toMatchObject({
      source: 'hellofresh',
      status: 'received',
      mealCount: 3,
      itemsAdded: MERGED_ITEM_COUNT,
      weekOf: '2026-08-10',
      locationId: 'loc-fridge',
    });
    expect(delivery.recipeIds).toEqual(['r1', 'r2', 'r3']);
    expect(delivery.createdAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('puts every ingredient in the chosen location, tagged hellofresh', async () => {
    await add();

    const items = writesTo(`users/${uid}/inventory`);
    expect(items).toHaveLength(MERGED_ITEM_COUNT);

    items.forEach((item) => {
      // The fields firestore.rules requires on an inventory create.
      expect(item).toMatchObject({
        locationId: 'loc-fridge',
        locationType: 'fridge',
        source: 'hellofresh',
      });
      expect(item.name).toBeTruthy();
      expect(item.normalized).toBeTruthy();
      expect(item.quantity).toBeGreaterThan(0);
      expect(item.addedAt).toEqual({ __sentinel: 'serverTimestamp' });
    });
  });

  it('gives each ingredient a real use-by date from the shelf-life data', async () => {
    await add();

    const items = writesTo(`users/${uid}/inventory`);
    const chicken = items.find((item) => item.normalized === 'chicken breast');
    const garlic = items.find((item) => item.normalized === 'garlic');

    // Reference data: chicken breast keeps 2 days in a fridge, garlic 90.
    expect(chicken.shelfLifeDays).toBe(2);
    expect(toDateKey(chicken.expiresAt)).toBe('2026-08-16');
    expect(garlic.shelfLifeDays).toBe(90);
    expect(chicken.expiresAt.getTime()).toBeLessThan(garlic.expiresAt.getTime());
  });

  it('falls back to a sensible shelf life for an ingredient with no fridge entry', async () => {
    await add({
      recipes: [
        makeHelloFreshRecipe({
          id: 'r9',
          ingredients: [{ name: 'Rice', quantity: 1, unit: 'cup', normalized: 'rice' }],
        }),
      ],
    });

    // The reference data lists rice as pantry-only, but the box still goes in
    // the fridge — it must still get a date rather than none.
    const [item] = writesTo(`users/${uid}/inventory`);
    expect(item.shelfLifeDays).toBeGreaterThan(0);
    expect(item.expiresAt).toBeInstanceOf(Date);
  });

  it('schedules the meals on cook days 1, 3, and 5', async () => {
    await add();

    const meals = writesTo(`users/${uid}/mealPlanEntries`);
    expect(meals.map((meal) => meal.date)).toEqual(['2026-08-14', '2026-08-16', '2026-08-18']);
    expect(meals.map((meal) => meal.recipeName)).toEqual([
      'Sweet Chili Chicken',
      'Sheet Pan Salmon',
      'Veggie Tacos',
    ]);
  });

  it('writes entries the meal plan page can actually read', async () => {
    await add();

    // Every key phase 7's factory produces, so a delivered meal renders on the
    // week exactly like one scheduled by hand.
    const reference = makeMealPlanEntry();
    const ignored = new Set(['id']);
    const expectedKeys = Object.keys(reference).filter((key) => !ignored.has(key));

    writesTo(`users/${uid}/mealPlanEntries`).forEach((meal) => {
      expectedKeys.forEach((key) => expect(meal).toHaveProperty(key));

      expect(meal).toMatchObject({
        mealType: 'dinner',
        source: 'hellofresh',
        status: 'planned',
        cookedAt: null,
        batchGroup: null,
        planId: null,
      });
      expect(meal.recipeId).toBeTruthy();
      expect(meal.servings).toBeGreaterThan(0);
      expect(meal.createdAt).toEqual({ __sentinel: 'serverTimestamp' });
      // The rules match `date` against this exact pattern.
      expect(meal.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('fills in usesIngredients, so Mark as Cooked knows what to decrement', async () => {
    await add();

    const [meal] = writesTo(`users/${uid}/mealPlanEntries`);

    expect(meal.usesIngredients).toEqual([
      { name: 'Chicken Breast', normalized: 'chicken breast', quantity: 2, unit: 'unit' },
      { name: 'Garlic', normalized: 'garlic', quantity: 2, unit: 'clove' },
    ]);
  });

  it('never schedules into the collection nothing reads', async () => {
    await add();

    // The regression this guards: writing users/{uid}/mealPlan means a
    // delivery silently fails to appear on the user's week.
    expect(writesTo(`users/${uid}/mealPlan`)).toEqual([]);
  });

  it('links every scheduled meal and stored item back to the delivery', async () => {
    await add();

    const meals = writesTo(`users/${uid}/mealPlanEntries`);
    const items = writesTo(`users/${uid}/inventory`);
    const deliveryIds = new Set([...meals, ...items].map((doc) => doc.deliveryId));

    expect(deliveryIds.size).toBe(1);
    expect([...deliveryIds][0]).toBeTruthy();
  });

  it('remembers the schedule so the next box is expected', async () => {
    await add();

    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`users/${uid}`);
    expect(patch['helloFresh.enabled']).toBe(true);
    expect(patch['helloFresh.deliveryDay']).toBe('friday');
    expect(patch['helloFresh.mealsPerWeek']).toBe(3);
    expect(toDateKey(patch['helloFresh.nextDeliveryDate'])).toBe('2026-08-21');
  });

  it('updates only the helloFresh keys, leaving email and signup date alone', async () => {
    await add();

    const [, patch] = fs.updateDoc.mock.calls[0];
    Object.keys(patch).forEach((key) => expect(key.startsWith('helloFresh.')).toBe(true));
  });

  it.each([
    ['no location', { location: undefined }, /where/i],
    ['a location that cannot hold food', { location: { id: 'x', type: 'garage' } }, /cannot hold/i],
    ['an unparseable date', { deliveredAt: 'not a date' }, /valid delivery date/i],
  ])('refuses %s', async (_label, overrides, pattern) => {
    const { outcome } = await add(overrides);

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(pattern);
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('accepts a box with no recipes picked yet', async () => {
    const { outcome } = await add({ recipes: [] });

    expect(outcome.success).toBe(true);
    expect(writesTo(`users/${uid}/inventory`)).toHaveLength(0);
    expect(writesTo(`users/${uid}/mealPlanEntries`)).toHaveLength(0);
    expect(writesTo(`users/${uid}/deliveries`)[0].mealCount).toBe(0);
  });

  it('reports a write failure rather than claiming the box was logged', async () => {
    fs.addDoc.mockRejectedValueOnce(new Error('permission denied'));

    const { outcome, result } = await add();

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/could not be saved/i);
    expect(result.current.saving).toBe(false);
  });

  it('will not log a delivery when nobody is signed in', async () => {
    authMock.__setUser(null);
    const { result } = renderDeliveries();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.addDelivery({ recipes, location: fridge });
    });

    expect(outcome.success).toBe(false);
    expect(fs.addDoc).not.toHaveBeenCalled();
  });
});

describe('deleteDelivery', () => {
  it('removes the delivery record', async () => {
    const { result } = renderDeliveries();

    await act(async () => {
      await result.current.deleteDelivery('delivery-1');
    });

    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe(`users/${uid}/deliveries/delivery-1`);
  });

  it('reports a failure instead of silently leaving it on screen', async () => {
    fs.deleteDoc.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderDeliveries();

    let outcome;
    await act(async () => {
      outcome = await result.current.deleteDelivery('delivery-1');
    });

    expect(outcome.success).toBe(false);
  });
});
