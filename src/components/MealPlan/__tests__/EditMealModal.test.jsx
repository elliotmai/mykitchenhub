// Amending a meal already on the board. The interesting parts are what the
// dialog refuses to do — change the recipe identity or the day — and what it
// does when a save comes back refused.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EditMealModal from '../EditMealModal';
import { MEAL_TYPES } from '../../../hooks/useMealPlan';

const entry = {
  id: 'entry-1',
  date: '2026-08-20',
  recipeName: 'Sheet Pan Salmon',
  servings: 2,
  mealType: 'dinner',
  notes: '',
};

const setup = (props = {}) => {
  const onSave = jest.fn(async () => ({ success: true }));
  const onHide = jest.fn();
  const utils = render(
    <EditMealModal show onHide={onHide} onSave={onSave} entry={entry} {...props} />
  );
  return { ...utils, onSave, onHide };
};

it('renders nothing at all when no meal is open', () => {
  const { container } = render(
    <EditMealModal show onHide={jest.fn()} onSave={jest.fn()} entry={null} />
  );

  expect(container).toBeEmptyDOMElement();
});

it('opens seeded with the meal as it currently stands', () => {
  setup();

  expect(screen.getByLabelText(/meal/i)).toHaveValue('Sheet Pan Salmon');
  expect(screen.getByLabelText(/servings/i)).toHaveValue(2);
  expect(screen.getByLabelText(/sitting/i)).toHaveValue('dinner');
});

it('offers every sitting the meal plan knows about', () => {
  setup();

  const options = screen.getAllByRole('option');
  expect(options.map((option) => option.value)).toEqual([...MEAL_TYPES]);
});

it('re-seeds when a different meal is opened', () => {
  const { rerender } = setup();

  rerender(
    <EditMealModal
      show
      onHide={jest.fn()}
      onSave={jest.fn()}
      entry={{ ...entry, id: 'entry-2', recipeName: 'Chicken Tacos', servings: 4 }}
    />
  );

  // Without the effect's dependency on the entry, this would still read the
  // first meal's numbers.
  expect(screen.getByLabelText(/meal/i)).toHaveValue('Chicken Tacos');
  expect(screen.getByLabelText(/servings/i)).toHaveValue(4);
});

it('hands the changed fields to the caller with the entry they belong to', async () => {
  const user = userEvent.setup();
  const { onSave } = setup();

  await user.clear(screen.getByLabelText(/servings/i));
  await user.type(screen.getByLabelText(/servings/i), '4');
  await user.selectOptions(screen.getByLabelText(/sitting/i), 'lunch');
  await user.type(screen.getByLabelText(/notes/i), 'Double the sauce');
  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith(
    entry,
    expect.objectContaining({
      recipeName: 'Sheet Pan Salmon',
      servings: '4',
      mealType: 'lunch',
      notes: 'Double the sauce',
    })
  );
});

it('closes once the save lands', async () => {
  const user = userEvent.setup();
  const { onHide } = setup();

  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onHide).toHaveBeenCalled());
});

it('stays open when the save is refused, so the edit is still there to fix', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn(async () => ({ success: false, error: 'Nope.' }));
  const { onHide } = setup({ onSave });

  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onHide).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/meal/i)).toBeInTheDocument();
});

it('will not save a meal with no name', async () => {
  const user = userEvent.setup();
  const { onSave } = setup();

  await user.clear(screen.getByLabelText(/meal/i));

  expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});

it('cancels without writing anything', async () => {
  const user = userEvent.setup();
  const { onHide, onSave } = setup();

  await user.click(screen.getByRole('button', { name: /cancel/i }));

  expect(onHide).toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});
