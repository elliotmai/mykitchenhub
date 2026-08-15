import React from 'react';

import {
  makeHelloFreshRecipe,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '../../../test-utils';
import AddDeliveryModal from '../AddDeliveryModal';

const locations = [
  { id: 'loc-freezer', label: 'Freezer', type: 'freezer', icon: '❄️' },
  { id: 'loc-fridge', label: 'Main Fridge', type: 'fridge', icon: '🧊' },
  { id: 'loc-pantry', label: 'Pantry', type: 'pantry', icon: '🏺' },
];

const recipes = [
  makeHelloFreshRecipe({ id: 'r1', name: 'Sweet Chili Chicken' }),
  makeHelloFreshRecipe({ id: 'r2', name: 'Sheet Pan Salmon' }),
];

const setup = (props = {}) => {
  const onSubmit = jest.fn().mockResolvedValue({ success: true });
  const onHide = jest.fn();
  const utils = renderWithProviders(
    <AddDeliveryModal
      show
      onHide={onHide}
      onSubmit={onSubmit}
      recipes={recipes}
      locations={locations}
      {...props}
    />
  );
  return { ...utils, onSubmit, onHide };
};

it('lists the imported recipes to pick from', () => {
  setup();

  expect(screen.getByRole('checkbox', { name: /sweet chili chicken/i })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /sheet pan salmon/i })).toBeInTheDocument();
});

it('defaults the destination to the fridge, where a box belongs', () => {
  setup();

  expect(screen.getByLabelText(/where are you putting/i)).toHaveValue('loc-fridge');
});

it('offers every storage location, not just fridges', () => {
  setup();

  const select = screen.getByLabelText(/where are you putting/i);
  expect(select).toHaveDisplayValue('🧊 Main Fridge');
  expect(within(select).getAllByRole('option')).toHaveLength(3);
});

it('previews exactly what logging the box will do', async () => {
  const { user } = setup();

  await user.click(screen.getByRole('checkbox', { name: /sweet chili chicken/i }));

  expect(await screen.findByText(/here.s what will happen/i)).toBeInTheDocument();
  // makeHelloFreshRecipe has two ingredients.
  expect(screen.getByText(/2 ingredients added to Main Fridge/i)).toBeInTheDocument();
  expect(screen.getByText(/Sweet Chili Chicken on/i)).toBeInTheDocument();
});

it('submits the picked meals, the date, and the location', async () => {
  const { onSubmit, user } = setup();

  await user.click(screen.getByRole('checkbox', { name: /sweet chili chicken/i }));
  await user.click(screen.getByRole('checkbox', { name: /sheet pan salmon/i }));
  await user.click(screen.getByRole('button', { name: /add delivery/i }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  const payload = onSubmit.mock.calls[0][0];
  expect(payload.recipes.map((recipe) => recipe.id)).toEqual(['r1', 'r2']);
  expect(payload.location).toMatchObject({ id: 'loc-fridge', type: 'fridge' });
  expect(payload.deliveredAt).toBeInstanceOf(Date);
});

it('builds the delivery date in local time, not UTC', async () => {
  const { onSubmit, user } = setup();

  const dateField = screen.getByLabelText(/when did it arrive/i);
  await user.clear(dateField);
  await user.type(dateField, '2026-08-14');

  await user.click(screen.getByRole('checkbox', { name: /sweet chili chicken/i }));
  await user.click(screen.getByRole('button', { name: /add delivery/i }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  // A bare YYYY-MM-DD parsed as UTC would be the 13th west of Greenwich.
  const { deliveredAt } = onSubmit.mock.calls[0][0];
  expect(deliveredAt.getFullYear()).toBe(2026);
  expect(deliveredAt.getMonth()).toBe(7);
  expect(deliveredAt.getDate()).toBe(14);
});

it('lets a meal be unticked again', async () => {
  const { onSubmit, user } = setup();

  const checkbox = screen.getByRole('checkbox', { name: /sweet chili chicken/i });
  await user.click(checkbox);
  await user.click(checkbox);
  await user.click(screen.getByRole('checkbox', { name: /sheet pan salmon/i }));
  await user.click(screen.getByRole('button', { name: /add delivery/i }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0].recipes.map((recipe) => recipe.id)).toEqual(['r2']);
});

it('asks for at least one meal before logging anything', async () => {
  const { onSubmit, user } = setup();

  await user.click(screen.getByRole('button', { name: /add delivery/i }));

  expect(await screen.findByText(/pick at least one meal/i)).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

it('closes once the delivery is logged', async () => {
  const { onHide, user } = setup();

  await user.click(screen.getByRole('checkbox', { name: /sweet chili chicken/i }));
  await user.click(screen.getByRole('button', { name: /add delivery/i }));

  await waitFor(() => expect(onHide).toHaveBeenCalled());
});

it('stays open and explains itself when the write fails', async () => {
  const onSubmit = jest.fn().mockResolvedValue({ success: false, error: 'Firestore is offline.' });
  const { onHide, user } = setup({ onSubmit });

  await user.click(screen.getByRole('checkbox', { name: /sweet chili chicken/i }));
  await user.click(screen.getByRole('button', { name: /add delivery/i }));

  expect(await screen.findByText('Firestore is offline.')).toBeInTheDocument();
  expect(onHide).not.toHaveBeenCalled();
});

it('tells a cook with no recipes yet what to do first', () => {
  setup({ recipes: [] });

  expect(screen.getByText(/import a recipe first/i)).toBeInTheDocument();
});

it('shows a spinner while the recipe list loads', () => {
  setup({ recipes: [], recipesLoading: true });

  expect(screen.getByRole('status', { name: /loading recipes/i })).toBeInTheDocument();
});

it('says what it is doing while the box is being logged', () => {
  setup({ saving: true });

  expect(screen.getByText(/adding…/i)).toBeInTheDocument();
});

it('copes with an account that has no storage locations', async () => {
  const { onSubmit, user } = setup({ locations: [] });

  expect(screen.getByLabelText(/where are you putting/i)).toBeDisabled();

  await user.click(screen.getByRole('checkbox', { name: /sweet chili chicken/i }));
  await user.click(screen.getByRole('button', { name: /add delivery/i }));

  expect(await screen.findByText(/choose where the ingredients should go/i)).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});
