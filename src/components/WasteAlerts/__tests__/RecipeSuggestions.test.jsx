// The recipe list has one job: make it obvious which recipe rescues the most
// food, and let the cook plan it in one tap.

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import RecipeSuggestions from '../RecipeSuggestions';
import { makeItem, makeRecipe } from '../../../test-utils/factories';

const match = (title, itemNames, overrides = {}) => ({
  recipe: makeRecipe({ id: `recipe-${title}`, name: title }),
  title,
  usesItems: itemNames.map((name) => makeItem({ name })),
  matchCount: itemNames.length,
  ...overrides,
});

const renderList = (props = {}) =>
  render(
    <MemoryRouter>
      <RecipeSuggestions {...props} />
    </MemoryRouter>
  );

describe('RecipeSuggestions content', () => {
  it('names the recipe and the food it would use up', () => {
    renderList({ suggestions: [match('Creamed Spinach', ['Spinach', 'Milk'])] });

    expect(screen.getByText('Creamed Spinach')).toBeInTheDocument();
    expect(screen.getByText('Uses Spinach, Milk')).toBeInTheDocument();
    expect(screen.getByText('2 expiring items')).toBeInTheDocument();
  });

  it('gets the singular right for a recipe that rescues one thing', () => {
    renderList({ suggestions: [match('Salmon Bake', ['Salmon'])] });
    expect(screen.getByText('1 expiring item')).toBeInTheDocument();
  });

  it('offers the recipe library when nothing matches', () => {
    renderList({ suggestions: [] });

    expect(screen.getByText(/No recipes use what is expiring/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse the recipe library/ })).toBeInTheDocument();
  });

  it('shows a spinner while the library is loading', () => {
    renderList({ suggestions: [], loading: true });
    expect(screen.getByText(/Finding recipes/)).toBeInTheDocument();
  });
});

describe('RecipeSuggestions add to meal plan', () => {
  it('adds the recipe and confirms it landed', async () => {
    const onAddToMealPlan = jest.fn().mockResolvedValue({ success: true });
    const suggestion = match('Creamed Spinach', ['Spinach']);
    renderList({ suggestions: [suggestion], onAddToMealPlan });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Add to Meal Plan/ }));
    });

    expect(onAddToMealPlan).toHaveBeenCalledWith(suggestion);
    await waitFor(() => expect(screen.getByRole('button', { name: /On the plan/ })).toBeDisabled());
  });

  it('links out to the meal plan once something is on it', async () => {
    renderList({
      suggestions: [match('Creamed Spinach', ['Spinach'])],
      onAddToMealPlan: jest.fn().mockResolvedValue({ success: true }),
    });

    expect(screen.queryByRole('link', { name: /See your meal plan/ })).not.toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Add to Meal Plan/ }));
    });

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /See your meal plan/ })).toBeInTheDocument()
    );
  });

  it('explains a failure and leaves the button usable', async () => {
    const onAddToMealPlan = jest
      .fn()
      .mockResolvedValue({ success: false, error: 'You are offline.' });
    renderList({ suggestions: [match('Creamed Spinach', ['Spinach'])], onAddToMealPlan });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Add to Meal Plan/ }));
    });

    await waitFor(() => expect(screen.getByText('You are offline.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Add to Meal Plan/ })).toBeEnabled();
  });
});
