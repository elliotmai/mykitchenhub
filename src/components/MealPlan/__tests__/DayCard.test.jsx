// The day card is where a cook actually moves dinner around and ticks it off,
// so these tests are written around those two actions.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DayCard, { DRAG_TYPE } from '../DayCard';
import { buildWeekDays } from '../../../hooks/useMealPlan';
import { makeMealPlanEntry } from '../../../test-utils/factories';

const days = buildWeekDays('2026-08-10', '2026-08-12');
const monday = days[0];

/** A DataTransfer-alike, since jsdom does not implement one. */
const dataTransfer = (initial = {}) => {
  const store = { ...initial };
  return {
    data: store,
    setData: (type, value) => {
      store[type] = value;
    },
    getData: (type) => store[type] ?? '',
  };
};

const renderDay = (props = {}) =>
  render(
    <DayCard
      day={monday}
      days={days}
      entries={[]}
      onAdd={jest.fn()}
      onCook={jest.fn()}
      onRemove={jest.fn()}
      onMove={jest.fn()}
      onDropMeal={jest.fn()}
      {...props}
    />
  );

describe('DayCard content', () => {
  it('names the day and its date', () => {
    renderDay();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText(/10/)).toBeInTheDocument();
  });

  it('says so when nothing is planned', () => {
    renderDay();
    expect(screen.getByText('Nothing planned')).toBeInTheDocument();
  });

  it('lists the meals with their type and servings', () => {
    renderDay({
      entries: [makeMealPlanEntry({ recipeName: 'Sheet Pan Salmon', servings: 4 })],
    });

    expect(screen.getByText('Sheet Pan Salmon')).toBeInTheDocument();
    expect(screen.getByText(/dinner/)).toBeInTheDocument();
    expect(screen.getByText(/4 servings/)).toBeInTheDocument();
  });

  it('uses the singular for a meal for one', () => {
    renderDay({ entries: [makeMealPlanEntry({ servings: 1 })] });
    expect(screen.getByText(/1 serving$/)).toBeInTheDocument();
  });

  it('says where a meal came from when it was not scheduled by hand', () => {
    renderDay({ entries: [makeMealPlanEntry({ source: 'hellofresh' })] });
    expect(screen.getByText('From your HelloFresh box')).toBeInTheDocument();
  });

  it('explains a waste-prevention suggestion', () => {
    renderDay({ entries: [makeMealPlanEntry({ source: 'waste-prevention' })] });
    expect(screen.getByText(/about to expire/)).toBeInTheDocument();
  });

  it('marks today', () => {
    renderDay({ day: days.find((d) => d.isToday) });
    expect(screen.getByText('Today')).toBeInTheDocument();
  });
});

describe('DayCard actions', () => {
  it('adds a meal on this day', async () => {
    const onAdd = jest.fn();
    renderDay({ onAdd });

    await userEvent.click(screen.getByRole('button', { name: /Add a meal on Mon 10/ }));
    expect(onAdd).toHaveBeenCalledWith('2026-08-10');
  });

  it('marks a meal cooked', async () => {
    const onCook = jest.fn();
    const entry = makeMealPlanEntry({ recipeName: 'Sheet Pan Salmon' });
    renderDay({ entries: [entry], onCook });

    await userEvent.click(screen.getByRole('button', { name: /Cooked/ }));
    expect(onCook).toHaveBeenCalledWith(entry);
  });

  it('removes a meal', async () => {
    const onRemove = jest.fn();
    const entry = makeMealPlanEntry({ recipeName: 'Sheet Pan Salmon' });
    renderDay({ entries: [entry], onRemove });

    await userEvent.click(screen.getByRole('button', { name: 'Remove Sheet Pan Salmon' }));
    expect(onRemove).toHaveBeenCalledWith(entry);
  });

  it('moves a meal with the keyboard, not just by dragging', async () => {
    const onMove = jest.fn();
    const entry = makeMealPlanEntry({ recipeName: 'Sheet Pan Salmon', date: '2026-08-10' });
    renderDay({ entries: [entry], onMove });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Move Sheet Pan Salmon to another day' }),
      '2026-08-13'
    );

    expect(onMove).toHaveBeenCalledWith(entry, '2026-08-13');
  });

  it('offers no cook or move controls once a meal is cooked', () => {
    renderDay({ entries: [makeMealPlanEntry({ status: 'cooked', recipeName: 'Salmon' })] });

    expect(screen.getByText('Cooked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cooked$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

describe('DayCard drag and drop', () => {
  it('carries the entry id when a meal starts being dragged', () => {
    const entry = makeMealPlanEntry({ id: 'entry-7' });
    renderDay({ entries: [entry] });

    const transfer = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('meal-entry-entry-7'), { dataTransfer: transfer });

    expect(transfer.getData(DRAG_TYPE)).toBe('entry-7');
  });

  it('reschedules the dropped meal onto this day', () => {
    const onDropMeal = jest.fn();
    renderDay({ onDropMeal });

    fireEvent.drop(screen.getByTestId('day-card-2026-08-10'), {
      dataTransfer: dataTransfer({ [DRAG_TYPE]: 'entry-7' }),
    });

    expect(onDropMeal).toHaveBeenCalledWith('entry-7', '2026-08-10');
  });

  it('falls back to text/plain, which is what some browsers hand over', () => {
    const onDropMeal = jest.fn();
    renderDay({ onDropMeal });

    fireEvent.drop(screen.getByTestId('day-card-2026-08-10'), {
      dataTransfer: dataTransfer({ 'text/plain': 'entry-9' }),
    });

    expect(onDropMeal).toHaveBeenCalledWith('entry-9', '2026-08-10');
  });

  it('ignores a drop that carries nothing', () => {
    const onDropMeal = jest.fn();
    renderDay({ onDropMeal });

    fireEvent.drop(screen.getByTestId('day-card-2026-08-10'), { dataTransfer: dataTransfer() });
    expect(onDropMeal).not.toHaveBeenCalled();
  });

  it('does not let a cooked meal be dragged away', () => {
    renderDay({ entries: [makeMealPlanEntry({ id: 'entry-1', status: 'cooked' })] });
    expect(screen.getByTestId('meal-entry-entry-1')).toHaveAttribute('draggable', 'false');
  });
});

// ---------------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------------

describe('a meal that is no longer for dinner', () => {
  it('shows a skipped meal as settled rather than still on the menu', () => {
    renderDay({ entries: [makeMealPlanEntry({ recipeName: 'Chilli', status: 'skipped' })] });

    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cooked/ })).not.toBeInTheDocument();
  });

  it('cannot be dragged to another day', () => {
    const { container } = renderDay({
      entries: [makeMealPlanEntry({ id: 'e1', status: 'skipped' })],
    });

    expect(container.querySelector('[data-testid="meal-entry-e1"]')).toHaveAttribute(
      'draggable',
      'false'
    );
  });

  it.each(['cooked', 'skipped'])('can still be removed from the board when %s', async (status) => {
    const onRemove = jest.fn();
    renderDay({ entries: [makeMealPlanEntry({ recipeName: 'Chilli', status })], onRemove });

    // Logging the wrong meal, or scheduling a recipe that has since been
    // deleted, otherwise leaves a card with no way off the board.
    await userEvent.click(screen.getByRole('button', { name: 'Remove Chilli' }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('while one meal is being logged', () => {
  const twoMeals = [
    makeMealPlanEntry({ id: 'a', recipeName: 'Chilli' }),
    makeMealPlanEntry({ id: 'b', recipeName: 'Soup' }),
  ];

  it('only that meal’s button waits', () => {
    renderDay({ entries: twoMeals, busyEntryId: 'a' });

    const buttons = screen.getAllByRole('button', { name: /Cooked/ });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeEnabled();
  });
});

it('hands the whole entry back when a meal is edited', async () => {
  const user = userEvent.setup();
  const entry = makeMealPlanEntry({ id: 'e1', date: monday.date, recipeName: 'Sheet Pan Salmon' });
  const onEdit = jest.fn();
  renderDay({ entries: [entry], onEdit });

  await user.click(screen.getByRole('button', { name: /edit sheet pan salmon/i }));

  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
});

it('hides the edit button when there is nothing to handle it', () => {
  const entry = makeMealPlanEntry({ id: 'e1', date: monday.date, recipeName: 'Sheet Pan Salmon' });
  renderDay({ entries: [entry] });

  expect(screen.queryByRole('button', { name: /edit sheet pan salmon/i })).not.toBeInTheDocument();
});
