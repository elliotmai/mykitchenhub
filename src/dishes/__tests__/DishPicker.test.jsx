import React from 'react';
import { renderWithProviders, screen, waitFor } from '../../test-utils';
import * as fs from '../../test-utils/mocks/firestore';
import { asDocs, makeRecipe } from '../../test-utils/factories';
import DishPicker from '../DishPicker';

const RECIPES = [
  makeRecipe({
    id: 'l1',
    name: 'Lasagna',
    ingredients: [{ name: 'pasta', quantity: 1, unit: 'box' }],
  }),
  makeRecipe({ id: 'l2', name: "Grandma's Lasagna", ingredients: [] }),
];

beforeEach(() => {
  fs.getDocs.mockImplementation(async (target) =>
    fs.pathOf(target) === 'dishes'
      ? fs.__querySnapshot([fs.__doc('lasagna', { favoriteRecipeId: 'l2' })])
      : fs.__querySnapshot(asDocs(RECIPES))
  );
});

it('lets the cook choose which recipe of a planned dish to cook', async () => {
  const { user } = renderWithProviders(
    <DishPicker entry={{ id: 'e1', dishId: 'lasagna', recipeId: null, recipeName: 'Lasagna' }} />
  );
  const select = await screen.findByLabelText('Which Lasagna recipe?');
  expect(screen.getByRole('option', { name: "Grandma's Lasagna (favourite)" })).toBeInTheDocument();
  await user.selectOptions(select, 'l1');
  await waitFor(() => expect(fs.updateDoc).toHaveBeenCalled());
  const [ref, patch] = fs.updateDoc.mock.calls.at(-1);
  expect(fs.pathOf(ref)).toBe('users/test-uid/mealPlanEntries/e1');
  expect(patch).toMatchObject({
    recipeId: 'l1',
    recipeName: 'Lasagna',
    usesIngredients: [expect.objectContaining({ name: 'pasta' })],
  });
});

it('stays away once a recipe is chosen, or for a meal that is not a dish', async () => {
  renderWithProviders(<DishPicker entry={{ id: 'e1', dishId: 'lasagna', recipeId: 'l1' }} />);
  renderWithProviders(<DishPicker entry={{ id: 'e2', recipeName: 'Toast' }} />);
  await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
});
