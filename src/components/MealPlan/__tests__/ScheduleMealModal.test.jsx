// Picking what to cook: the modal reads the shared recipe library and hands
// the meal plan a schema-valid entry, ingredients included.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ScheduleMealModal, { recipeLabel, recipeIngredients } from '../ScheduleMealModal';
import { buildWeekDays } from '../../../hooks/useMealPlan';
import * as fs from '../../../test-utils/mocks/firestore';
import { asDocs, makeRecipe } from '../../../test-utils/factories';

const days = buildWeekDays('2026-08-10', '2026-08-12');

const renderModal = (props = {}) =>
  render(
    <ScheduleMealModal
      show
      onHide={jest.fn()}
      onSave={jest.fn(async () => ({ success: true }))}
      date="2026-08-12"
      days={days}
      {...props}
    />
  );

/** Put recipes behind the one-shot getDocs the modal makes on open. */
const withRecipes = (recipes) => fs.getDocs.mockResolvedValue(fs.__querySnapshot(asDocs(recipes)));

describe('recipeLabel', () => {
  it('prefers `name`, the field the rules require', () => {
    expect(recipeLabel({ name: 'Salmon', title: 'Old Title' })).toBe('Salmon');
  });

  it('falls back to `title` for older fixtures', () => {
    expect(recipeLabel({ title: 'Sheet Pan Salmon' })).toBe('Sheet Pan Salmon');
  });

  it('never renders an empty option', () => {
    expect(recipeLabel({})).toBe('Untitled recipe');
    expect(recipeLabel(null)).toBe('Untitled recipe');
  });
});

describe('recipeIngredients', () => {
  it('normalises names so the shopping list and inventory can match them', () => {
    const ingredients = recipeIngredients({
      ingredients: [{ name: 'Salmon Fillet', quantity: '2', unit: 'fillet' }],
    });

    expect(ingredients).toEqual([
      { name: 'Salmon Fillet', normalized: 'salmon fillet', quantity: 2, unit: 'fillet' },
    ]);
  });

  it('copes with a recipe that lists no ingredients', () => {
    expect(recipeIngredients({})).toEqual([]);
  });
});

describe('ScheduleMealModal', () => {
  it('offers the recipes from the shared library', async () => {
    withRecipes([makeRecipe({ id: 'r1', name: 'Sheet Pan Salmon' })]);
    renderModal();

    expect(await screen.findByRole('option', { name: 'Sheet Pan Salmon' })).toBeInTheDocument();
    expect(fs.pathOf(fs.getDocs.mock.calls[0][0])).toBe('recipes');
  });

  it('schedules a library recipe with its ingredients attached', async () => {
    withRecipes([
      makeRecipe({
        id: 'r1',
        name: 'Sheet Pan Salmon',
        ingredients: [{ name: 'Salmon', quantity: 2, unit: 'fillet' }],
      }),
    ]);
    const onSave = jest.fn(async () => ({ success: true }));
    renderModal({ onSave });

    await screen.findByRole('option', { name: 'Sheet Pan Salmon' });
    await userEvent.selectOptions(screen.getByLabelText('Recipe'), 'r1');
    await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-08-12',
        mealType: 'dinner',
        servings: 2,
        recipeId: 'r1',
        recipeName: 'Sheet Pan Salmon',
        usesIngredients: [{ name: 'Salmon', normalized: 'salmon', quantity: 2, unit: 'fillet' }],
      })
    );
  });

  it('accepts a meal that is not in the library at all', async () => {
    withRecipes([]);
    const onSave = jest.fn(async () => ({ success: true }));
    renderModal({ onSave });

    await userEvent.type(await screen.findByLabelText('What are you cooking?'), 'Takeout');
    await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ recipeName: 'Takeout', recipeId: null, usesIngredients: [] })
      )
    );
  });

  it('asks for a name rather than saving an empty meal', async () => {
    withRecipes([]);
    const onSave = jest.fn();
    renderModal({ onSave });

    await userEvent.click(await screen.findByRole('button', { name: 'Add to plan' }));

    expect(await screen.findByText(/Choose a recipe/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lets the cook change the day and the meal', async () => {
    withRecipes([]);
    const onSave = jest.fn(async () => ({ success: true }));
    renderModal({ onSave });

    await userEvent.type(await screen.findByLabelText('What are you cooking?'), 'Porridge');
    await userEvent.selectOptions(screen.getByLabelText('Day'), '2026-08-14');
    await userEvent.selectOptions(screen.getByLabelText('Meal'), 'breakfast');
    await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-08-14', mealType: 'breakfast' })
      )
    );
  });

  it('closes once the meal is saved', async () => {
    withRecipes([]);
    const onHide = jest.fn();
    renderModal({ onHide, onSave: async () => ({ success: true }) });

    await userEvent.type(await screen.findByLabelText('What are you cooking?'), 'Soup');
    await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

    await waitFor(() => expect(onHide).toHaveBeenCalled());
  });

  it('keeps the modal open and shows why when the write is rejected', async () => {
    withRecipes([]);
    const onHide = jest.fn();
    renderModal({ onHide, onSave: async () => ({ success: false, error: 'permission denied' }) });

    await userEvent.type(await screen.findByLabelText('What are you cooking?'), 'Soup');
    await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

    expect(await screen.findByText('permission denied')).toBeInTheDocument();
    expect(onHide).not.toHaveBeenCalled();
  });

  it('still lets a cook plan when the recipe library cannot be read', async () => {
    fs.getDocs.mockRejectedValue(new Error('offline'));
    renderModal();

    expect(await screen.findByLabelText('What are you cooking?')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------------

describe('the recipe library the picker can actually see', () => {
  it('lists a legacy recipe that only carries `title`', async () => {
    // Ordering by `name` server-side drops documents missing that field, so a
    // library synced from legacy would show up empty however many recipes it has.
    withRecipes([
      makeRecipe({ id: 'r1', name: 'Sheet Pan Salmon' }),
      { id: 'r2', title: 'Grandma’s Stew', ingredients: [] },
    ]);
    renderModal();

    expect(await screen.findByRole('option', { name: 'Grandma’s Stew' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sheet Pan Salmon' })).toBeInTheDocument();
  });

  it('sorts what it found by the name the cook reads', async () => {
    withRecipes([
      makeRecipe({ id: 'r1', name: 'Zucchini Bake' }),
      { id: 'r2', title: 'Apple Crumble', ingredients: [] },
      makeRecipe({ id: 'r3', name: 'Miso Soup' }),
    ]);
    renderModal();

    await screen.findByRole('option', { name: 'Apple Crumble' });
    const labels = [...screen.getByLabelText('Recipe').options]
      .map((option) => option.textContent)
      .filter((label) => label !== 'Something else…');

    expect(labels).toEqual(['Apple Crumble', 'Miso Soup', 'Zucchini Bake']);
  });

  it('still lets a cook name a meal when the library is empty', async () => {
    withRecipes([]);
    const onSave = jest.fn(async () => ({ success: true }));
    renderModal({ onSave });

    await screen.findByRole('option', { name: 'Something else…' });
    await userEvent.type(screen.getByLabelText('What are you cooking?'), 'Leftovers');
    await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ recipeName: 'Leftovers', usesIngredients: [] });
  });
});
