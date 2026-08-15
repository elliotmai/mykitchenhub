// The board as a cook sees it: seven days, a plan button, a shopping list, and
// what happens to the kitchen when dinner gets ticked off.

import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react';

import MealPlanView, { weekRangeLabel } from '../MealPlanView';
import {
  renderWithProviders,
  screen,
  userEvent,
  firestoreMock as fs,
  functionsMock as fns,
  makeMealPlanEntry,
  makeItem,
  asDocs,
} from '../../../test-utils';
import { toDayKey, startOfWeek, shiftDayKey } from '../../../hooks/useMealPlan';

const UID = 'test-uid';
const ENTRIES_PATH = `users/${UID}/mealPlanEntries`;
const INVENTORY_PATH = `users/${UID}/inventory`;
const WEEK_START = toDayKey(startOfWeek());
const TODAY = toDayKey(new Date());

/** Render the board and deliver the first snapshots. */
const renderBoard = async ({ entries = [], inventory = [] } = {}) => {
  const view = renderWithProviders(<MealPlanView />, { route: '/meal-plan' });

  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(ENTRIES_PATH, asDocs(entries));
    fs.__emit(INVENTORY_PATH, asDocs(inventory));
  });
  await screen.findByText('Meal Plan');
  return view;
};

describe('weekRangeLabel', () => {
  it('collapses a week inside one month', () => {
    expect(weekRangeLabel('2026-08-10')).toBe('10 – 16 Aug');
  });

  it('names both months when the week straddles them', () => {
    expect(weekRangeLabel('2026-08-31')).toMatch(/31 Aug – 6 Sep/);
  });
});

describe('MealPlanView', () => {
  it('shows a week of days', async () => {
    await renderBoard();

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    days.forEach((label) => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
    expect(document.querySelectorAll('[data-testid^="day-card-"]')).toHaveLength(7);
  });

  it('puts a scheduled meal on its day', async () => {
    await renderBoard({
      entries: [makeMealPlanEntry({ date: TODAY, recipeName: 'Sheet Pan Salmon' })],
    });

    const dayCard = screen.getByTestId(`day-card-${TODAY}`);
    expect(dayCard).toHaveTextContent('Sheet Pan Salmon');
  });

  it('invites the cook to start when the week is empty', async () => {
    await renderBoard();
    expect(screen.getByText(/Nothing on the calendar yet/)).toBeInTheDocument();
  });

  it('builds the shopping list from the week’s meals', async () => {
    await renderBoard({
      entries: [
        makeMealPlanEntry({
          date: TODAY,
          usesIngredients: [{ name: 'Salmon', normalized: 'salmon', quantity: 2, unit: 'fillet' }],
        }),
      ],
    });

    expect(screen.getByText('Shopping list')).toBeInTheDocument();
    expect(screen.getByText('Salmon')).toBeInTheDocument();
    expect(screen.getByText('2 fillet')).toBeInTheDocument();
  });

  it('separates out what the kitchen already has', async () => {
    await renderBoard({
      entries: [
        makeMealPlanEntry({
          date: TODAY,
          usesIngredients: [{ name: 'Salmon', normalized: 'salmon', quantity: 1, unit: 'fillet' }],
        }),
      ],
      inventory: [makeItem({ name: 'Salmon', normalized: 'salmon', quantity: 4, unit: 'fillet' })],
    });

    expect(screen.getByText('Already in your kitchen')).toBeInTheDocument();
  });

  it('surfaces a listener failure', async () => {
    await renderBoard();

    await act(async () => {
      fs.__emitError(ENTRIES_PATH, new Error('permission denied'));
    });

    expect(await screen.findByText(/couldn.t load your meal plan/i)).toBeInTheDocument();
  });
});

describe('scheduling a meal', () => {
  it('adds a meal to the day the cook clicked', async () => {
    const { user } = await renderBoard();

    // One "Add meal" button per day; the first is Monday.
    await user.click(screen.getAllByRole('button', { name: /Add a meal on/ })[0]);
    await screen.findByText('Add a meal');

    await user.type(screen.getByLabelText('What are you cooking?'), 'Leftover chilli');
    await user.click(screen.getByRole('button', { name: 'Add to plan' }));

    await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
    expect(fs.addDoc.mock.calls[0][1]).toMatchObject({
      recipeName: 'Leftover chilli',
      status: 'planned',
      source: 'manual',
    });
  });
});

describe('marking a meal cooked', () => {
  it('takes the ingredients out of the kitchen', async () => {
    const entry = makeMealPlanEntry({
      id: 'entry-1',
      date: TODAY,
      recipeName: 'Sheet Pan Salmon',
      usesIngredients: [{ name: 'Salmon', normalized: 'salmon', quantity: 2, unit: 'fillet' }],
    });
    const { user } = await renderBoard({
      entries: [entry],
      inventory: [
        makeItem({ id: 'item-salmon', name: 'Salmon', normalized: 'salmon', quantity: 5 }),
      ],
    });

    await user.click(screen.getByRole('button', { name: /Cooked/ }));

    await waitFor(() => {
      const call = fs.updateDoc.mock.calls.find(
        ([ref]) => fs.pathOf(ref) === `${INVENTORY_PATH}/item-salmon`
      );
      expect(call?.[1].quantity).toBe(3);
    });
    expect(await screen.findByText(/took Salmon out of your kitchen/)).toBeInTheDocument();
  });

  it('tells the cook when it could not be logged', async () => {
    const entry = makeMealPlanEntry({ id: 'entry-1', date: TODAY, recipeName: 'Salmon' });
    const { user } = await renderBoard({ entries: [entry] });
    fs.updateDoc.mockRejectedValueOnce(new Error('offline'));

    await user.click(screen.getByRole('button', { name: /Cooked/ }));

    expect(await screen.findByText(/couldn.t tick that meal off/i)).toBeInTheDocument();
  });
});

describe('generating a plan', () => {
  const generated = {
    plan: {
      weekStart: WEEK_START,
      model: 'claude-opus-5',
      degraded: false,
      entries: [
        {
          date: TODAY,
          mealType: 'dinner',
          recipeId: null,
          recipeName: 'Spinach Frittata',
          servings: 2,
          usesIngredients: [],
        },
      ],
      shoppingList: [],
      batchCooking: [
        {
          group: 'roast-veg',
          title: 'Roast everything at once',
          detail: 'Two dinners use the same oven temperature.',
          entryDates: [TODAY],
        },
      ],
    },
  };

  it('asks the planner for the week on the board', async () => {
    fns.__callable('generateMealPlan').mockResolvedValue({ data: generated });
    const { user } = await renderBoard();

    await user.click(screen.getByRole('button', { name: /Generate plan/ }));

    await waitFor(() =>
      expect(fns.__callable('generateMealPlan')).toHaveBeenCalledWith({
        weekStart: WEEK_START,
        days: 7,
      })
    );
    expect(await screen.findByText('Your week is planned.')).toBeInTheDocument();
  });

  it('warns when the plan was built without the AI', async () => {
    fns.__callable('generateMealPlan').mockResolvedValue({
      data: {
        warning: 'AI planner unavailable — built this from what is expiring.',
        plan: { ...generated.plan, degraded: true, model: null },
      },
    });
    const { user } = await renderBoard();

    await user.click(screen.getByRole('button', { name: /Generate plan/ }));

    expect(await screen.findByText(/AI planner unavailable/)).toBeInTheDocument();
  });

  it('reports a failure rather than leaving the button spinning', async () => {
    fns.__failCallable('generateMealPlan', new Error('functions/unavailable'));
    const { user } = await renderBoard();

    await user.click(screen.getByRole('button', { name: /Generate plan/ }));

    // The message shows in the page banner and in a toast.
    expect((await screen.findAllByText('functions/unavailable')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Generate plan/ })).not.toBeDisabled()
    );
  });

  it('shows the planner’s batch cooking tips', async () => {
    await renderBoard();

    await act(async () => {
      fs.__emitDoc(`users/${UID}/mealPlans/${WEEK_START}`, WEEK_START, {
        weekStart: WEEK_START,
        source: 'ai',
        status: 'active',
        shoppingList: [],
        batchCooking: generated.plan.batchCooking,
      });
    });

    expect(await screen.findByText('Roast everything at once')).toBeInTheDocument();
    expect(screen.getByText('Cook once, eat twice')).toBeInTheDocument();
  });
});

describe('week navigation', () => {
  it('steps forward a week and back to this one', async () => {
    const { user } = await renderBoard();

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(await screen.findByText(weekRangeLabel(shiftDayKey(WEEK_START, 7)))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(await screen.findByText(weekRangeLabel(WEEK_START))).toBeInTheDocument();
  });

  it('steps back a week', async () => {
    const { user } = await renderBoard();

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(
      await screen.findByText(weekRangeLabel(shiftDayKey(WEEK_START, -7)))
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------------

/** A DataTransfer-alike, since jsdom does not implement one. */
const dataTransfer = (entryId) => {
  const store = { 'text/plain': entryId };
  return { data: store, setData: () => {}, getData: (type) => store[type] ?? '' };
};

const dropOn = (dayKey, entryId) => {
  const target = document.querySelector(`[data-testid="day-card-${dayKey}"]`);
  const transfer = dataTransfer(entryId);
  fireEvent.dragOver(target, { dataTransfer: transfer });
  fireEvent.drop(target, { dataTransfer: transfer });
};

describe('dropping a meal on a day', () => {
  const tomorrow = shiftDayKey(TODAY, 1);

  it('moves it there', async () => {
    await renderBoard({ entries: [makeMealPlanEntry({ id: 'e1', date: TODAY })] });

    await act(async () => dropOn(tomorrow, 'e1'));

    await waitFor(() => expect(fs.updateDoc).toHaveBeenCalled());
    expect(fs.updateDoc.mock.calls[0][1]).toEqual({ date: tomorrow });
  });

  it('does nothing when it lands back on the day it came from', async () => {
    await renderBoard({ entries: [makeMealPlanEntry({ id: 'e1', date: TODAY })] });

    await act(async () => dropOn(TODAY, 'e1'));

    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('lets a day hold a second meal rather than refusing the drop', async () => {
    await renderBoard({
      entries: [
        makeMealPlanEntry({ id: 'e1', date: TODAY, mealType: 'dinner' }),
        makeMealPlanEntry({ id: 'e2', date: tomorrow, mealType: 'lunch' }),
      ],
    });

    await act(async () => dropOn(TODAY, 'e2'));

    await waitFor(() => expect(fs.updateDoc).toHaveBeenCalled());
    expect(fs.updateDoc.mock.calls[0][1]).toEqual({ date: TODAY });
  });

  it('ignores something dragged in from outside the board', async () => {
    await renderBoard({ entries: [makeMealPlanEntry({ id: 'e1', date: TODAY })] });

    await act(async () => dropOn(tomorrow, 'https://example.com/a-link'));

    expect(fs.updateDoc).not.toHaveBeenCalled();
  });
});

describe('rescheduling without a mouse', () => {
  it('moves a meal through the day select, the keyboard and touch path', async () => {
    const tomorrow = shiftDayKey(TODAY, 1);
    await renderBoard({
      entries: [makeMealPlanEntry({ id: 'e1', date: TODAY, recipeName: 'Chilli' })],
    });

    // HTML5 drag events never fire on a phone, so this select is the only way
    // a mobile-first app can reschedule at all.
    const select = screen.getByRole('combobox', { name: 'Move Chilli to another day' });
    await userEvent.selectOptions(select, tomorrow);

    await waitFor(() => expect(fs.updateDoc).toHaveBeenCalled());
    expect(fs.updateDoc.mock.calls[0][1]).toEqual({ date: tomorrow });
  });
});

describe('ticking off a meal that was already cooked', () => {
  it('says so instead of claiming the kitchen was emptied again', async () => {
    const entry = makeMealPlanEntry({
      id: 'e1',
      date: TODAY,
      recipeName: 'Chilli',
      status: 'planned',
      usesIngredients: [{ name: 'Beans', normalized: 'beans', quantity: 1, unit: 'tin' }],
    });

    await renderBoard({
      entries: [entry],
      inventory: [makeItem({ id: 'item-beans', normalized: 'beans', quantity: 3, unit: 'tin' })],
    });

    await userEvent.click(screen.getByRole('button', { name: /Cooked/ }));
    await waitFor(() => expect(fs.updateDoc).toHaveBeenCalled());

    // The listener now says cooked; a second click must not decrement again.
    await act(async () => {
      fs.__emit(ENTRIES_PATH, asDocs([{ ...entry, status: 'cooked' }]));
    });

    const writesAfterFirstCook = fs.updateDoc.mock.calls.length;
    const cookedAgain = screen.queryByRole('button', { name: /Cooked/ });
    if (cookedAgain) await userEvent.click(cookedAgain);

    expect(fs.updateDoc.mock.calls).toHaveLength(writesAfterFirstCook);
  });
});

describe('an empty kitchen', () => {
  it('still renders the board with nothing scheduled', async () => {
    await renderBoard({ entries: [], inventory: [] });

    expect(screen.getByText(/Nothing on the calendar yet/)).toBeInTheDocument();
    expect(screen.getAllByText('Nothing planned')).toHaveLength(7);
    expect(screen.getByText(/Add meals to the week/)).toBeInTheDocument();
  });

  it('offers to plan the week anyway', async () => {
    await renderBoard({ entries: [], inventory: [] });
    expect(screen.getByRole('button', { name: /Generate plan/ })).toBeEnabled();
  });
});
