// Covers the meal plan hook: the pure planning helpers (day keys, shopping
// list, batch grouping, inventory decrements) and the Firestore-backed
// scheduling surface — including the writes other sections will make.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useMealPlan, {
  toDayKey,
  fromDayKey,
  startOfWeek,
  shiftDayKey,
  buildWeekDays,
  sortEntries,
  buildShoppingList,
  groupBatchTasks,
  planInventoryDecrements,
  MEAL_TYPES,
} from '../useMealPlan';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as fns from '../../test-utils/mocks/functions';
import * as authMock from '../../test-utils/mocks/auth';
import {
  asDocs,
  makeItem,
  makeMealPlanEntry,
  makeMealPlan,
  makeUserProfile,
  dayKey,
} from '../../test-utils/factories';

const UID = 'test-uid';
const ENTRIES_PATH = `users/${UID}/mealPlanEntries`;
const INVENTORY_PATH = `users/${UID}/inventory`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

/** Render the hook signed in, with the first snapshots already delivered. */
const renderMealPlan = async ({ entries = [], inventory = [] } = {}) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useMealPlan(), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(ENTRIES_PATH, asDocs(entries));
    fs.__emit(INVENTORY_PATH, asDocs(inventory));
  });
  return view;
};

// ---------------------------------------------------------------------------
// Day keys
// ---------------------------------------------------------------------------

describe('day keys', () => {
  it('formats a date in local time, not UTC', () => {
    // 1 Jan at 23:00 local is 2 Jan in UTC east of Greenwich — the day card
    // would land on the wrong column if this used toISOString().
    expect(toDayKey(new Date(2026, 0, 1, 23, 0, 0))).toBe('2026-01-01');
  });

  it('pads single-digit months and days', () => {
    expect(toDayKey(new Date(2026, 7, 5))).toBe('2026-08-05');
  });

  it('round-trips through fromDayKey', () => {
    expect(toDayKey(fromDayKey('2026-08-15'))).toBe('2026-08-15');
  });

  it('shifts across a month boundary', () => {
    expect(shiftDayKey('2026-08-30', 3)).toBe('2026-09-02');
    expect(shiftDayKey('2026-09-02', -3)).toBe('2026-08-30');
  });

  it.each([
    ['a Monday', new Date(2026, 7, 10), '2026-08-10'],
    ['a Wednesday', new Date(2026, 7, 12), '2026-08-10'],
    ['a Sunday', new Date(2026, 7, 16), '2026-08-10'],
  ])('starts the week on Monday for %s', (_label, date, expected) => {
    expect(toDayKey(startOfWeek(date))).toBe(expected);
  });
});

describe('buildWeekDays', () => {
  it('returns seven consecutive days starting at the week start', () => {
    const days = buildWeekDays('2026-08-10', '2026-08-12');

    expect(days).toHaveLength(7);
    expect(days.map((d) => d.key)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
    expect(days[0].label).toBe('Mon');
    expect(days[6].label).toBe('Sun');
  });

  it('marks today and the days already gone', () => {
    const days = buildWeekDays('2026-08-10', '2026-08-12');

    expect(days.find((d) => d.key === '2026-08-12').isToday).toBe(true);
    expect(days.find((d) => d.key === '2026-08-10').isPast).toBe(true);
    expect(days.find((d) => d.key === '2026-08-14').isPast).toBe(false);
  });
});

describe('sortEntries', () => {
  it('puts a day in the order it is eaten', () => {
    const sorted = sortEntries([
      makeMealPlanEntry({ mealType: 'dinner', recipeName: 'Salmon' }),
      makeMealPlanEntry({ mealType: 'breakfast', recipeName: 'Oats' }),
      makeMealPlanEntry({ mealType: 'lunch', recipeName: 'Soup' }),
    ]);

    expect(sorted.map((e) => e.recipeName)).toEqual(['Oats', 'Soup', 'Salmon']);
  });
});

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

describe('buildShoppingList', () => {
  const salmonDinner = (overrides = {}) =>
    makeMealPlanEntry({
      usesIngredients: [{ name: 'Salmon', normalized: 'salmon', quantity: 2, unit: 'fillet' }],
      ...overrides,
    });

  it('sums the same ingredient across several meals', () => {
    const list = buildShoppingList([salmonDinner(), salmonDinner()], []);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ normalized: 'salmon', quantity: 4, unit: 'fillet' });
  });

  it('marks an ingredient the kitchen already has', () => {
    const list = buildShoppingList(
      [salmonDinner()],
      [makeItem({ name: 'Salmon', quantity: 4, unit: 'fillet' })]
    );

    expect(list[0].haveInInventory).toBe(true);
    expect(list[0].onHand).toBe(4);
  });

  it('still lists an ingredient the kitchen only partly covers', () => {
    const list = buildShoppingList(
      [salmonDinner()],
      [makeItem({ name: 'Salmon', quantity: 1, unit: 'fillet' })]
    );

    expect(list[0].haveInInventory).toBe(false);
  });

  it('ignores meals that have already been cooked', () => {
    expect(buildShoppingList([salmonDinner({ status: 'cooked' })], [])).toEqual([]);
  });

  it('matches inventory case-insensitively', () => {
    const list = buildShoppingList(
      [salmonDinner()],
      [makeItem({ name: 'SALMON', normalized: 'SALMON', quantity: 9 })]
    );

    expect(list[0].haveInInventory).toBe(true);
  });

  it('returns an empty list when nothing is planned', () => {
    expect(buildShoppingList([], [makeItem()])).toEqual([]);
  });

  it('sorts alphabetically so the list reads like a shop', () => {
    const list = buildShoppingList(
      [
        makeMealPlanEntry({
          usesIngredients: [
            { name: 'Rice', normalized: 'rice', quantity: 1, unit: 'cup' },
            { name: 'Aubergine', normalized: 'aubergine', quantity: 1, unit: 'ea' },
          ],
        }),
      ],
      []
    );

    expect(list.map((i) => i.name)).toEqual(['Aubergine', 'Rice']);
  });
});

// ---------------------------------------------------------------------------
// Batch cooking
// ---------------------------------------------------------------------------

describe('groupBatchTasks', () => {
  it('groups meals the planner tagged as one cooking session', () => {
    const tips = groupBatchTasks([
      makeMealPlanEntry({
        id: 'a',
        batchGroup: 'roast-veg',
        recipeName: 'Roast Tray',
        date: dayKey(0),
      }),
      makeMealPlanEntry({
        id: 'b',
        batchGroup: 'roast-veg',
        recipeName: 'Veg Bowl',
        date: dayKey(2),
      }),
    ]);

    expect(tips).toHaveLength(1);
    expect(tips[0].group).toBe('roast-veg');
    expect(tips[0].entryIds).toEqual(['a', 'b']);
  });

  it('ignores a batch group with only one meal in it', () => {
    const tips = groupBatchTasks([makeMealPlanEntry({ batchGroup: 'roast-veg' })]);
    expect(tips).toEqual([]);
  });

  it('spots a shared ingredient across two different days', () => {
    const shared = [{ name: 'Onion', normalized: 'onion', quantity: 1, unit: 'ea' }];
    const tips = groupBatchTasks([
      makeMealPlanEntry({ id: 'a', date: dayKey(0), recipeName: 'Curry', usesIngredients: shared }),
      makeMealPlanEntry({ id: 'b', date: dayKey(3), recipeName: 'Soup', usesIngredients: shared }),
    ]);

    expect(tips).toHaveLength(1);
    expect(tips[0].title).toMatch(/Prep Onion once/);
    expect(tips[0].entryDates).toEqual([dayKey(0), dayKey(3)].sort());
  });

  it('does not suggest batching two meals on the same day', () => {
    const shared = [{ name: 'Onion', normalized: 'onion', quantity: 1, unit: 'ea' }];
    const tips = groupBatchTasks([
      makeMealPlanEntry({ id: 'a', date: dayKey(0), mealType: 'lunch', usesIngredients: shared }),
      makeMealPlanEntry({ id: 'b', date: dayKey(0), mealType: 'dinner', usesIngredients: shared }),
    ]);

    expect(tips).toEqual([]);
  });

  it('leaves cooked meals out of the suggestions', () => {
    const shared = [{ name: 'Onion', normalized: 'onion', quantity: 1, unit: 'ea' }];
    const tips = groupBatchTasks([
      makeMealPlanEntry({ id: 'a', date: dayKey(0), usesIngredients: shared, status: 'cooked' }),
      makeMealPlanEntry({ id: 'b', date: dayKey(3), usesIngredients: shared }),
    ]);

    expect(tips).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Inventory decrements
// ---------------------------------------------------------------------------

describe('planInventoryDecrements', () => {
  it('subtracts what the meal used from the matching item', () => {
    const patches = planInventoryDecrements(
      makeMealPlanEntry({
        usesIngredients: [{ name: 'Salmon', normalized: 'salmon', quantity: 2, unit: 'fillet' }],
      }),
      [makeItem({ id: 'item-salmon', name: 'Salmon', normalized: 'salmon', quantity: 5 })]
    );

    expect(patches).toEqual([{ id: 'item-salmon', name: 'Salmon', quantity: 3 }]);
  });

  it('floors at zero rather than going negative, which the rules would reject', () => {
    const patches = planInventoryDecrements(
      makeMealPlanEntry({
        usesIngredients: [{ name: 'Salmon', normalized: 'salmon', quantity: 9, unit: 'fillet' }],
      }),
      [makeItem({ id: 'item-salmon', normalized: 'salmon', quantity: 2 })]
    );

    expect(patches[0].quantity).toBe(0);
  });

  it('skips ingredients the kitchen does not stock', () => {
    const patches = planInventoryDecrements(
      makeMealPlanEntry({
        usesIngredients: [{ name: 'Saffron', normalized: 'saffron', quantity: 1, unit: 'g' }],
      }),
      [makeItem({ normalized: 'salmon', quantity: 2 })]
    );

    expect(patches).toEqual([]);
  });

  it('returns nothing for a meal with no tracked ingredients', () => {
    expect(
      planInventoryDecrements(makeMealPlanEntry({ usesIngredients: [] }), [makeItem()])
    ).toEqual([]);
    expect(planInventoryDecrements(null, [makeItem()])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

describe('useMealPlan subscription', () => {
  it('subscribes to the signed-in user’s meal plan entries', async () => {
    await renderMealPlan();

    const paths = fs.onSnapshot.mock.calls.map(([ref]) => fs.pathOf(ref));
    expect(paths).toContain(ENTRIES_PATH);
  });

  it('buckets the week’s meals by day', async () => {
    const { result } = await renderMealPlan({
      entries: [
        makeMealPlanEntry({ id: 'today', date: dayKey(0), recipeName: 'Salmon' }),
        makeMealPlanEntry({ id: 'other-week', date: shiftDayKey(dayKey(0), 60) }),
      ],
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entriesByDay[dayKey(0)].map((e) => e.recipeName)).toEqual(['Salmon']);
    // Meals outside the visible week are loaded but not on the board.
    expect(result.current.weekEntries.map((e) => e.id)).toEqual(['today']);
  });

  it('reports an error when the listener fails', async () => {
    const { result } = await renderMealPlan();

    await act(async () => {
      fs.__emitError(ENTRIES_PATH, new Error('permission denied'));
    });

    await waitFor(() => expect(result.current.error).toMatch(/Failed to load/));
  });

  it('drops its listeners on unmount', async () => {
    const { unmount } = await renderMealPlan();
    expect(fs.__listenerCount(ENTRIES_PATH)).toBeGreaterThan(0);

    unmount();
    expect(fs.__listenerCount(ENTRIES_PATH)).toBe(0);
  });

  it('stays empty and stops loading when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useMealPlan(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

describe('scheduleMeal', () => {
  it('writes a schema-valid entry to the meal plan collection', async () => {
    const { result } = await renderMealPlan();

    await act(async () => {
      await result.current.scheduleMeal({
        date: '2026-08-15',
        mealType: 'dinner',
        recipeId: 'recipe-1',
        recipeName: '  Sheet Pan Salmon  ',
        servings: 2,
      });
    });

    expect(fs.addDoc).toHaveBeenCalled();
    const [ref, payload] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(ENTRIES_PATH);
    expect(payload).toMatchObject({
      date: '2026-08-15',
      mealType: 'dinner',
      recipeName: 'Sheet Pan Salmon',
      servings: 2,
      status: 'planned',
      source: 'manual',
    });
    expect(payload.createdAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('records the source when another feature schedules the meal', async () => {
    const { result } = await renderMealPlan();

    await act(async () => {
      await result.current.scheduleMeal({
        date: '2026-08-15',
        recipeName: 'Delivered Box Meal',
        source: 'hellofresh',
      });
    });

    expect(fs.addDoc.mock.calls[0][1].source).toBe('hellofresh');
  });

  it.each([
    ['a missing day', { recipeName: 'Toast' }, /Pick a day/],
    ['a missing recipe', { date: '2026-08-15', recipeName: '  ' }, /Pick a recipe/],
    [
      'an unknown meal type',
      { date: '2026-08-15', recipeName: 'Toast', mealType: 'brunch' },
      /Invalid meal type/,
    ],
    ['zero servings', { date: '2026-08-15', recipeName: 'Toast', servings: 0 }, /greater than 0/],
  ])('refuses %s before hitting Firestore', async (_label, input, message) => {
    const { result } = await renderMealPlan();

    let outcome;
    await act(async () => {
      outcome = await result.current.scheduleMeal(input);
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(message);
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('surfaces a Firestore failure instead of throwing', async () => {
    const { result } = await renderMealPlan();
    fs.addDoc.mockRejectedValueOnce(new Error('permission denied'));

    let outcome;
    await act(async () => {
      outcome = await result.current.scheduleMeal({ date: '2026-08-15', recipeName: 'Toast' });
    });

    expect(outcome).toEqual({ success: false, error: 'permission denied' });
  });
});

describe('rescheduleMeal', () => {
  it('moves a meal to another day', async () => {
    const { result } = await renderMealPlan({
      entries: [makeMealPlanEntry({ id: 'entry-1', date: dayKey(0) })],
    });

    await act(async () => {
      await result.current.rescheduleMeal('entry-1', '2026-08-17');
    });

    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`${ENTRIES_PATH}/entry-1`);
    expect(patch).toEqual({ date: '2026-08-17' });
  });

  it('never touches createdAt, which the rules pin', async () => {
    const { result } = await renderMealPlan();

    await act(async () => {
      await result.current.rescheduleMeal('entry-1', '2026-08-17', 'lunch');
    });

    expect(fs.updateDoc.mock.calls[0][1]).not.toHaveProperty('createdAt');
    expect(fs.updateDoc.mock.calls[0][1].mealType).toBe('lunch');
  });

  it('refuses a move with no target day', async () => {
    const { result } = await renderMealPlan();

    let outcome;
    await act(async () => {
      outcome = await result.current.rescheduleMeal('entry-1', '');
    });

    expect(outcome.success).toBe(false);
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });
});

describe('removeMeal', () => {
  it('deletes the entry', async () => {
    const { result } = await renderMealPlan();

    await act(async () => {
      await result.current.removeMeal('entry-1');
    });

    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe(`${ENTRIES_PATH}/entry-1`);
  });
});

// ---------------------------------------------------------------------------
// Mark as cooked
// ---------------------------------------------------------------------------

describe('markCooked', () => {
  const entry = makeMealPlanEntry({
    id: 'entry-1',
    date: dayKey(0),
    usesIngredients: [{ name: 'Salmon', normalized: 'salmon', quantity: 2, unit: 'fillet' }],
  });

  it('marks the meal cooked and stamps when', async () => {
    const { result } = await renderMealPlan({ entries: [entry] });

    await act(async () => {
      await result.current.markCooked(entry);
    });

    const call = fs.updateDoc.mock.calls.find(
      ([ref]) => fs.pathOf(ref) === `${ENTRIES_PATH}/entry-1`
    );
    expect(call[1]).toMatchObject({ status: 'cooked' });
    expect(call[1].cookedAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('takes the ingredients out of the kitchen', async () => {
    const { result } = await renderMealPlan({
      entries: [entry],
      inventory: [
        makeItem({ id: 'item-salmon', name: 'Salmon', normalized: 'salmon', quantity: 5 }),
      ],
    });

    await act(async () => {
      await result.current.markCooked(entry);
    });

    const inventoryCall = fs.updateDoc.mock.calls.find(
      ([ref]) => fs.pathOf(ref) === `${INVENTORY_PATH}/item-salmon`
    );
    expect(inventoryCall[1].quantity).toBe(3);
  });

  it('patches only the quantity, leaving addedAt alone as the rules require', async () => {
    const { result } = await renderMealPlan({
      entries: [entry],
      inventory: [makeItem({ id: 'item-salmon', normalized: 'salmon', quantity: 5 })],
    });

    await act(async () => {
      await result.current.markCooked(entry);
    });

    const inventoryCall = fs.updateDoc.mock.calls.find(
      ([ref]) => fs.pathOf(ref) === `${INVENTORY_PATH}/item-salmon`
    );
    expect(inventoryCall[1]).not.toHaveProperty('addedAt');
  });

  it('still logs the meal when nothing in the kitchen matches', async () => {
    const { result } = await renderMealPlan({ entries: [entry], inventory: [] });

    let outcome;
    await act(async () => {
      outcome = await result.current.markCooked(entry);
    });

    expect(outcome.success).toBe(true);
    expect(outcome.decremented).toEqual([]);
  });

  it('reports a failure rather than pretending the meal was logged', async () => {
    const { result } = await renderMealPlan({ entries: [entry] });
    fs.updateDoc.mockRejectedValueOnce(new Error('offline'));

    let outcome;
    await act(async () => {
      outcome = await result.current.markCooked(entry);
    });

    expect(outcome).toEqual({ success: false, error: 'offline' });
  });
});

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

describe('generatePlan', () => {
  const aiPlan = {
    plan: {
      weekStart: toDayKey(startOfWeek()),
      model: 'claude-opus-5',
      degraded: false,
      entries: [
        {
          date: dayKey(0),
          mealType: 'dinner',
          recipeId: 'recipe-1',
          recipeName: 'Spinach Frittata',
          servings: 2,
          usesIngredients: [{ name: 'Spinach', normalized: 'spinach', quantity: 1, unit: 'bag' }],
          batchGroup: null,
        },
      ],
      shoppingList: [
        {
          name: 'Spinach',
          normalized: 'spinach',
          quantity: 1,
          unit: 'bag',
          haveInInventory: false,
        },
      ],
      batchCooking: [],
    },
  };

  it('writes the generated meals through the normal rules-checked path', async () => {
    fns.__callable('generateMealPlan').mockResolvedValue({ data: aiPlan });
    const { result } = await renderMealPlan();

    await act(async () => {
      await result.current.generatePlan();
    });

    expect(fns.__callable('generateMealPlan')).toHaveBeenCalledWith({
      weekStart: result.current.weekStart,
      days: 7,
    });

    const entryWrite = fs.addDoc.mock.calls.find(([ref]) => fs.pathOf(ref) === ENTRIES_PATH);
    expect(entryWrite[1]).toMatchObject({
      recipeName: 'Spinach Frittata',
      source: 'ai',
      status: 'planned',
      planId: result.current.weekStart,
    });
  });

  it('saves the week’s shopping list and batch tips', async () => {
    fns.__callable('generateMealPlan').mockResolvedValue({ data: aiPlan });
    const { result } = await renderMealPlan();

    await act(async () => {
      await result.current.generatePlan();
    });

    const [ref, payload] = fs.setDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`users/${UID}/mealPlans/${result.current.weekStart}`);
    expect(payload).toMatchObject({
      weekStart: result.current.weekStart,
      source: 'ai',
      status: 'active',
      degraded: false,
    });
    expect(payload.shoppingList).toHaveLength(1);
  });

  it('replaces a previous generation but leaves hand-scheduled meals alone', async () => {
    fns.__callable('generateMealPlan').mockResolvedValue({ data: aiPlan });
    const weekStart = toDayKey(startOfWeek());
    const { result } = await renderMealPlan({
      entries: [
        makeMealPlanEntry({ id: 'old-ai', source: 'ai', planId: weekStart, date: dayKey(0) }),
        makeMealPlanEntry({ id: 'mine', source: 'manual', date: dayKey(0) }),
        makeMealPlanEntry({
          id: 'already-cooked',
          source: 'ai',
          planId: weekStart,
          status: 'cooked',
          date: dayKey(0),
        }),
      ],
    });

    await act(async () => {
      await result.current.generatePlan();
    });

    const deleted = fs.deleteDoc.mock.calls.map(([ref]) => fs.pathOf(ref));
    expect(deleted).toEqual([`${ENTRIES_PATH}/old-ai`]);
  });

  it('reports the degraded fallback so the cook knows the AI was skipped', async () => {
    fns.__callable('generateMealPlan').mockResolvedValue({
      data: {
        warning: 'AI planner unavailable; used what was expiring.',
        plan: { ...aiPlan.plan, degraded: true, model: null },
      },
    });
    const { result } = await renderMealPlan();

    let outcome;
    await act(async () => {
      outcome = await result.current.generatePlan();
    });

    expect(outcome).toMatchObject({ success: true, degraded: true });
    expect(outcome.warning).toMatch(/unavailable/);
  });

  it('surfaces an empty plan as an error instead of silently doing nothing', async () => {
    fns.__callable('generateMealPlan').mockResolvedValue({ data: { plan: { entries: [] } } });
    const { result } = await renderMealPlan();

    let outcome;
    await act(async () => {
      outcome = await result.current.generatePlan();
    });

    expect(outcome.success).toBe(false);
    expect(fs.addDoc).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it('surfaces a function failure and clears the spinner', async () => {
    fns.__failCallable('generateMealPlan', new Error('functions/internal'));
    const { result } = await renderMealPlan();

    let outcome;
    await act(async () => {
      outcome = await result.current.generatePlan();
    });

    expect(outcome.success).toBe(false);
    await waitFor(() => expect(result.current.generating).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// Week navigation and the week document
// ---------------------------------------------------------------------------

describe('week navigation', () => {
  it('moves a week at a time and back to today', async () => {
    const { result } = await renderMealPlan();
    const thisWeek = result.current.weekStart;

    act(() => result.current.goToWeek(1));
    expect(result.current.weekStart).toBe(shiftDayKey(thisWeek, 7));

    act(() => result.current.goToWeek(-2));
    expect(result.current.weekStart).toBe(shiftDayKey(thisWeek, -7));

    act(() => result.current.goToThisWeek());
    expect(result.current.weekStart).toBe(thisWeek);
  });

  it('reads the week document and merges its batch tips with the derived ones', async () => {
    const weekStart = toDayKey(startOfWeek());
    const { result } = await renderMealPlan();

    await act(async () => {
      fs.__emitDoc(
        `users/${UID}/mealPlans/${weekStart}`,
        weekStart,
        makeMealPlan({
          batchCooking: [
            { group: 'roast-veg', title: 'Roast it all at once', detail: 'One tray.' },
          ],
        })
      );
    });

    await waitFor(() => expect(result.current.plan).toBeTruthy());
    expect(result.current.batchTips[0]).toMatchObject({ group: 'roast-veg', fromAi: true });
  });
});

describe('MEAL_TYPES', () => {
  it('matches the meal types the security rules accept', () => {
    expect(MEAL_TYPES).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });
});
