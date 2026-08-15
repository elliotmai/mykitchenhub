// One recipe in the grid. The card is where the delete rule becomes visible:
// only recipes *this* cook added show a delete button, because those are the
// only ones the security rules let them delete. `recipes` is a shared library,
// so `source: 'user-created'` is not enough on its own — it says a cook added
// it, not which cook.

import React from 'react';
import { renderWithProviders, screen, makeRecipe } from '../../../test-utils';
import RecipeCard from '../RecipeCard';

const ME = 'test-uid';
const ANOTHER_COOK = 'someone-else-uid';

const render = (props = {}) =>
  renderWithProviders(<RecipeCard recipe={makeRecipe()} currentUid={ME} {...props} />);

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
      recipe: makeRecipe({ name: 'Mine', source: 'user-created', createdBy: ME }),
      onEdit: jest.fn(),
      onDelete: jest.fn(),
    });

    expect(screen.getByRole('button', { name: /Edit Mine/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete Mine/i })).toBeInTheDocument();
  });

  // The library is shared, so another cook's recipe is still `user-created`.
  // Editing it is allowed — anyone may fix a typo — but deleting it is not,
  // and the rules refuse it, so the button must not be there to press.
  it("offers edit but not delete on another cook's recipe", () => {
    render({
      recipe: makeRecipe({ name: 'Theirs', source: 'user-created', createdBy: ANOTHER_COOK }),
      onEdit: jest.fn(),
      onDelete: jest.fn(),
    });

    expect(screen.getByRole('button', { name: /Edit Theirs/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Theirs/i })).not.toBeInTheDocument();
  });

  it('offers no delete on a user-created recipe that names no author', () => {
    // Seeded and imported recipes carry no `createdBy`; the rules make them
    // undeletable, so the card must not offer the control.
    const orphan = makeRecipe({ name: 'Seeded', source: 'user-created' });
    delete orphan.createdBy;

    render({ recipe: orphan, onEdit: jest.fn(), onDelete: jest.fn() });

    expect(screen.queryByRole('button', { name: /Delete Seeded/i })).not.toBeInTheDocument();
  });

  it('offers no delete before the signed-in cook is known', () => {
    render({
      recipe: makeRecipe({ name: 'Mine', source: 'user-created', createdBy: ME }),
      currentUid: null,
      onDelete: jest.fn(),
    });

    expect(screen.queryByRole('button', { name: /Delete Mine/i })).not.toBeInTheDocument();
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
