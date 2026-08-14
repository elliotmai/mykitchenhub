// One recipe in the grid. The card is where the delete rule becomes visible:
// only recipes the user added show a delete button, because the security rules
// only allow deleting those.

import React from 'react';
import { renderWithProviders, screen, makeRecipe } from '../../../test-utils';
import RecipeCard from '../RecipeCard';

const render = (props = {}) => renderWithProviders(<RecipeCard recipe={makeRecipe()} {...props} />);

describe('RecipeCard', () => {
  it('shows the recipe name', () => {
    render({ recipe: makeRecipe({ name: 'Sheet Pan Salmon' }) });

    expect(screen.getByText('Sheet Pan Salmon')).toBeInTheDocument();
  });

  it('shows total time, servings and how often it has been cooked', () => {
    render({ recipe: makeRecipe({ prepTime: 10, cookTime: 15, servings: 4, timesCooked: 7 }) });

    expect(screen.getByText(/25 min/)).toBeInTheDocument();
    expect(screen.getByText(/Serves 4/)).toBeInTheDocument();
    expect(screen.getByText(/Cooked 7×/)).toBeInTheDocument();
  });

  it('leaves the time out entirely when the recipe has none recorded', () => {
    render({ recipe: makeRecipe({ prepTime: null, cookTime: null }) });

    expect(screen.queryByText(/min/)).not.toBeInTheDocument();
  });

  it('shows the difficulty', () => {
    render({ recipe: makeRecipe({ difficulty: 'hard' }) });

    expect(screen.getByText('hard')).toBeInTheDocument();
  });

  it('names where the recipe came from in words, not codes', () => {
    render({ recipe: makeRecipe({ source: 'legacy' }) });

    expect(screen.getByText("Let's Eat")).toBeInTheDocument();
  });

  it('shows the first few tags and counts the rest', () => {
    render({ recipe: makeRecipe({ tags: ['a', 'b', 'c', 'd', 'e'] }) });

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows the photo when there is one', () => {
    render({ recipe: makeRecipe({ name: 'Salmon', imageUrl: 'https://img.test/a.jpg' }) });

    expect(screen.getByAltText('Salmon')).toHaveAttribute('src', 'https://img.test/a.jpg');
  });

  it('renders without a photo rather than a broken image', () => {
    render({ recipe: makeRecipe({ imageUrl: null }) });

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('opens the recipe when View is clicked', async () => {
    const onView = jest.fn();
    const recipe = makeRecipe();
    const { user } = renderWithProviders(<RecipeCard recipe={recipe} onView={onView} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(onView).toHaveBeenCalledWith(recipe);
  });

  it('records a cook from the grid, without opening the recipe', async () => {
    const onCook = jest.fn();
    const recipe = makeRecipe({ name: 'Pasta' });
    const { user } = renderWithProviders(<RecipeCard recipe={recipe} onCook={onCook} />);

    await user.click(screen.getByRole('button', { name: /I cooked Pasta/i }));

    expect(onCook).toHaveBeenCalledWith(recipe);
  });

  it('offers edit and delete for a recipe the user created', () => {
    render({
      recipe: makeRecipe({ name: 'Mine', source: 'user-created' }),
      onEdit: jest.fn(),
      onDelete: jest.fn(),
    });

    expect(screen.getByRole('button', { name: /Edit Mine/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete Mine/i })).toBeInTheDocument();
  });

  // The rules only allow deleting `source: 'user-created'`, so offering the
  // button on anything else would be an invitation to a failed write.
  it.each(['legacy', 'spoonacular', 'hellofresh', 'ai-generated'])(
    'hides edit and delete for a %s recipe',
    (source) => {
      render({
        recipe: makeRecipe({ name: 'Theirs', source }),
        onEdit: jest.fn(),
        onDelete: jest.fn(),
      });

      expect(screen.queryByRole('button', { name: /Edit Theirs/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete Theirs/i })).not.toBeInTheDocument();
    }
  );

  it('renders nothing rather than crashing without a recipe', () => {
    renderWithProviders(<RecipeCard recipe={null} />);

    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
  });
});
