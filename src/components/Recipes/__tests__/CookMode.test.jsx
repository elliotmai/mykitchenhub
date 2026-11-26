// Cook mode — any recipe, planned or not, as step-by-step cards.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import CookMode, { splitStep } from '../CookMode';
import RecipeDetail from '../../../pages/RecipeDetail';
import { makeRecipe } from '../../../test-utils/factories';

const recipe = () =>
  makeRecipe({
    name: 'Beef Tacos',
    ingredients: [
      { name: 'ground beef', quantity: 10, unit: 'oz', normalized: 'ground beef' },
      { name: 'lime', quantity: 1, unit: '', normalized: 'lime', text: '1 lime' },
    ],
    instructions: ['Brown the beef: Cook it in a hot pan.', 'Warm the tortillas and serve.'],
  });

it('opens on the ingredients, then walks through every step', () => {
  render(<CookMode recipe={recipe()} onClose={jest.fn()} />);

  expect(screen.getByRole('dialog', { name: 'Cooking Beef Tacos' })).toBeInTheDocument();
  expect(screen.getByText('Gathered 0 of 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /10 oz ground beef/ }));
  expect(screen.getByText('Gathered 1 of 2')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Start step 1/ }));
  expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Brown the beef' })).toBeInTheDocument();
  expect(screen.getByText('Cook it in a hot pan.')).toBeInTheDocument();

  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
  expect(screen.getByText('Warm the tortillas and serve.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Ingredients' }));
  // Back on the first card, what was gathered is still gathered.
  expect(screen.getByText('Gathered 1 of 2')).toBeInTheDocument();
});

it('logs the cook from the last card, and closes on Escape', async () => {
  const onCooked = jest.fn(async () => ({ success: true }));
  const onClose = jest.fn();
  render(<CookMode recipe={recipe()} onClose={onClose} onCooked={onCooked} />);

  fireEvent.click(screen.getByRole('button', { name: 'Step 2' }));
  fireEvent.click(screen.getByRole('button', { name: /I cooked this/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Logged/ })).toBeInTheDocument());
  expect(onCooked).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

it('keeps the log button when logging fails', async () => {
  const onCooked = jest.fn(async () => ({ success: false }));
  render(<CookMode recipe={recipe()} onClose={jest.fn()} onCooked={onCooked} />);
  fireEvent.click(screen.getByRole('button', { name: 'Step 2' }));
  fireEvent.click(screen.getByRole('button', { name: /I cooked this/ }));
  await waitFor(() => expect(onCooked).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: /I cooked this/ })).toBeEnabled();
});

it('takes a heading off a step only when it is a short one', () => {
  expect(splitStep('Make the sauce: Whisk it all.')).toEqual({
    title: 'Make the sauce',
    body: 'Whisk it all.',
  });
  expect(splitStep('Bake at 400: about 20 minutes.').title).toBeNull();
  expect(splitStep('Whisk the eggs.')).toEqual({ title: null, body: 'Whisk the eggs.' });
});

it('the recipe page has a Cook button that opens cook mode', () => {
  render(<RecipeDetail recipe={recipe()} onBack={jest.fn()} onCook={jest.fn()} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cook' }));
  expect(screen.getByRole('dialog', { name: 'Cooking Beef Tacos' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stop cooking' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
