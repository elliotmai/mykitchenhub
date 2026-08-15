// The library screen: search, tag chips, filters and sorting. Filtering happens
// in memory over the whole streamed library, so these tests drive the real
// controls rather than stubbing the filter helpers.

import React from 'react';
import { renderWithProviders, screen, within, makeRecipe } from '../../../test-utils';
import RecipeList from '../RecipeList';

const LIBRARY = [
  makeRecipe({
    id: 'r1',
    name: 'Quick Pasta',
    tags: ['dinner', 'quick'],
    source: 'user-created',
    difficulty: 'easy',
    prepTime: 5,
    cookTime: 10,
  }),
  makeRecipe({
    id: 'r2',
    name: 'Slow Stew',
    tags: ['dinner'],
    source: 'legacy',
    difficulty: 'hard',
    prepTime: 20,
    cookTime: 160,
  }),
  makeRecipe({
    id: 'r3',
    name: 'Morning Toast',
    tags: ['breakfast'],
    source: 'hellofresh',
    difficulty: 'easy',
    prepTime: 2,
    cookTime: 3,
  }),
];

const render = (props = {}) => renderWithProviders(<RecipeList recipes={LIBRARY} {...props} />);

const cardNames = () =>
  screen
    .getAllByRole('button', { name: 'View' })
    .map((button) => within(button.closest('.recipe-card')).getByTitle(/./).textContent);

describe('RecipeList', () => {
  it('shows every recipe in the library', () => {
    render();

    expect(screen.getByText('Quick Pasta')).toBeInTheDocument();
    expect(screen.getByText('Slow Stew')).toBeInTheDocument();
    expect(screen.getByText('Morning Toast')).toBeInTheDocument();
  });

  it('counts the library in the header', () => {
    render();

    expect(screen.getByText(/3 recipes in your library/i)).toBeInTheDocument();
  });

  it('shows a spinner while loading rather than an empty library', () => {
    render({ recipes: [], loading: true });

    expect(screen.getByText(/loading recipes/i)).toBeInTheDocument();
    expect(screen.queryByText(/no recipes yet/i)).not.toBeInTheDocument();
  });

  it('invites the first recipe when the library is empty', async () => {
    const onAdd = jest.fn();
    const { user } = renderWithProviders(<RecipeList recipes={[]} onAdd={onAdd} />);

    expect(screen.getByText(/no recipes yet/i)).toBeInTheDocument();
    // The header and the empty state both offer it; the empty state is the one
    // a cook with nothing in the library will actually reach for.
    const buttons = screen.getAllByRole('button', { name: /add recipe/i });
    await user.click(buttons[buttons.length - 1]);

    expect(onAdd).toHaveBeenCalled();
  });

  describe('search', () => {
    it('filters by name', async () => {
      const { user } = render();

      await user.type(screen.getByLabelText('Search recipes'), 'pasta');

      expect(screen.getByText('Quick Pasta')).toBeInTheDocument();
      expect(screen.queryByText('Slow Stew')).not.toBeInTheDocument();
    });

    it('finds a recipe by an ingredient it contains', async () => {
      const { user } = renderWithProviders(
        <RecipeList
          recipes={[
            makeRecipe({
              id: 'r1',
              name: 'Mystery Dish',
              ingredients: [{ name: 'anchovy', normalized: 'anchovy' }],
            }),
          ]}
        />
      );

      await user.type(screen.getByLabelText('Search recipes'), 'anchovy');

      expect(screen.getByText('Mystery Dish')).toBeInTheDocument();
    });

    it('says so when nothing matches, and offers a way out', async () => {
      const { user } = render();

      await user.type(screen.getByLabelText('Search recipes'), 'lasagne');
      expect(screen.getByText(/no recipes match your filters/i)).toBeInTheDocument();

      // Offered twice: once beside the filter summary, once in the empty state.
      await user.click(screen.getAllByRole('button', { name: /clear filters/i })[0]);
      expect(screen.getByText('Quick Pasta')).toBeInTheDocument();
    });

    it('clears the search from the input itself', async () => {
      const { user } = render();
      const input = screen.getByLabelText('Search recipes');

      await user.type(input, 'pasta');
      await user.click(screen.getByRole('button', { name: /clear search/i }));

      expect(input).toHaveValue('');
      expect(screen.getByText('Slow Stew')).toBeInTheDocument();
    });
  });

  describe('filters', () => {
    it('filters by difficulty', async () => {
      const { user } = render();

      await user.selectOptions(screen.getByLabelText('Filter by difficulty'), 'hard');

      expect(screen.getByText('Slow Stew')).toBeInTheDocument();
      expect(screen.queryByText('Quick Pasta')).not.toBeInTheDocument();
    });

    it('filters by where the recipe came from', async () => {
      const { user } = render();

      await user.selectOptions(screen.getByLabelText('Filter by source'), 'legacy');

      expect(screen.getByText('Slow Stew')).toBeInTheDocument();
      expect(screen.queryByText('Morning Toast')).not.toBeInTheDocument();
    });

    it('filters by how long the cook has got', async () => {
      const { user } = render();

      await user.selectOptions(screen.getByLabelText('Filter by time'), '15');

      expect(screen.getByText('Quick Pasta')).toBeInTheDocument();
      expect(screen.getByText('Morning Toast')).toBeInTheDocument();
      expect(screen.queryByText('Slow Stew')).not.toBeInTheDocument();
    });

    it('filters by tag when a chip is pressed', async () => {
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'breakfast' }));

      expect(screen.getByText('Morning Toast')).toBeInTheDocument();
      expect(screen.queryByText('Quick Pasta')).not.toBeInTheDocument();
    });

    it('narrows further with a second tag rather than widening', async () => {
      const { user } = render();

      await user.click(screen.getByRole('button', { name: 'dinner' }));
      expect(screen.getByText('Slow Stew')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'quick' }));
      expect(screen.getByText('Quick Pasta')).toBeInTheDocument();
      expect(screen.queryByText('Slow Stew')).not.toBeInTheDocument();
    });

    it('unpresses a tag chip on a second click', async () => {
      const { user } = render();
      const chip = screen.getByRole('button', { name: 'breakfast' });

      await user.click(chip);
      expect(chip).toHaveAttribute('aria-pressed', 'true');

      await user.click(chip);
      expect(chip).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Quick Pasta')).toBeInTheDocument();
    });

    it('reports how much of the library is showing', async () => {
      const { user } = render();

      await user.selectOptions(screen.getByLabelText('Filter by difficulty'), 'hard');

      expect(screen.getByText(/showing 1 of 3 recipes/i)).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('sorts A to Z', async () => {
      const { user } = render();

      await user.selectOptions(screen.getByLabelText('Sort recipes'), 'name');

      expect(cardNames()).toEqual(['Morning Toast', 'Quick Pasta', 'Slow Stew']);
    });

    it('sorts quickest first', async () => {
      const { user } = render();

      await user.selectOptions(screen.getByLabelText('Sort recipes'), 'time');

      expect(cardNames()).toEqual(['Morning Toast', 'Quick Pasta', 'Slow Stew']);
    });

    it('sorts by most cooked', async () => {
      const { user } = renderWithProviders(
        <RecipeList
          recipes={[
            makeRecipe({ id: 'a', name: 'Rarely', timesCooked: 1 }),
            makeRecipe({ id: 'b', name: 'Often', timesCooked: 12 }),
          ]}
        />
      );

      await user.selectOptions(screen.getByLabelText('Sort recipes'), 'timesCooked');

      expect(cardNames()).toEqual(['Often', 'Rarely']);
    });
  });

  describe('actions', () => {
    it('opens the add form from the header', async () => {
      const onAdd = jest.fn();
      const { user } = render({ onAdd });

      await user.click(screen.getAllByRole('button', { name: /add recipe/i })[0]);

      expect(onAdd).toHaveBeenCalled();
    });

    it('opens a recipe', async () => {
      const onView = jest.fn();
      const { user } = render({ onView });

      await user.click(screen.getAllByRole('button', { name: 'View' })[0]);

      expect(onView).toHaveBeenCalled();
    });

    it('opens the legacy sync dashboard when one is wired up', async () => {
      const onOpenSync = jest.fn();
      const { user } = render({ onOpenSync });

      await user.click(screen.getByRole('button', { name: /legacy sync/i }));

      expect(onOpenSync).toHaveBeenCalled();
    });

    it('hides the sync entry point when there is no handler for it', () => {
      render();

      expect(screen.queryByRole('button', { name: /legacy sync/i })).not.toBeInTheDocument();
    });
  });
});
