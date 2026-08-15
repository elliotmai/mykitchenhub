// The recipe page, wired to the real hooks with Firestore mocked — the
// browse → open → cook → edit → delete loop a cook actually walks.
//
// The detail view lives on the `?recipe=<id>` search param rather than its own
// route, so it is deep-linkable without touching the shared route table.

import React from 'react';
import { renderWithProviders, screen, act, waitFor, within } from '../../test-utils';
import * as fs from '../../test-utils/mocks/firestore';
import { makeRecipe, makeItem, asDocs } from '../../test-utils/factories';
import Recipes from '../Recipes';

const UID = 'test-uid';

const LIBRARY = [
  makeRecipe({
    id: 'r1',
    name: 'Sheet Pan Salmon',
    source: 'user-created',
    tags: ['dinner'],
    ingredients: [
      { name: 'salmon', quantity: 2, unit: 'fillet', normalized: 'salmon' },
      { name: 'capers', quantity: 1, unit: 'tbsp', normalized: 'capers' },
    ],
    instructions: ['Heat the oven to 220C.', 'Roast for 15 minutes.'],
    timesCooked: 3,
  }),
  makeRecipe({
    id: 'r2',
    name: 'Grandma Chili',
    source: 'legacy',
    tags: ['dinner'],
    instructions: [],
  }),
];

/** Render the page with a library and an inventory already delivered. */
const renderRecipes = async ({ recipes = LIBRARY, items = [], route = '/recipes' } = {}) => {
  const view = renderWithProviders(<Recipes />, { route });

  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit('recipes', asDocs(recipes));
    fs.__emit(`users/${UID}/inventory`, asDocs(items));
  });

  return view;
};

describe('Recipes page — browsing', () => {
  it('lists the library', async () => {
    await renderRecipes();

    expect(screen.getByText('Sheet Pan Salmon')).toBeInTheDocument();
    expect(screen.getByText('Grandma Chili')).toBeInTheDocument();
  });

  it('opens a recipe into the full view, and puts it in the URL', async () => {
    const { user } = await renderRecipes();

    await user.click(
      within(screen.getByText('Sheet Pan Salmon').closest('.recipe-card')).getByRole('button', {
        name: 'View',
      })
    );

    expect(await screen.findByRole('heading', { name: 'Sheet Pan Salmon' })).toBeInTheDocument();
    expect(screen.getByText('Heat the oven to 220C.')).toBeInTheDocument();
  });

  it('opens straight into a recipe from a shared link', async () => {
    await renderRecipes({ route: '/recipes?recipe=r2' });

    expect(await screen.findByRole('heading', { name: 'Grandma Chili' })).toBeInTheDocument();
  });

  it('goes back to the library', async () => {
    const { user } = await renderRecipes({ route: '/recipes?recipe=r1' });

    await user.click(await screen.findByRole('button', { name: /back to recipes/i }));

    expect(screen.getByText('Grandma Chili')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sheet Pan Salmon' })).not.toBeInTheDocument();
  });

  it('says so plainly when a linked recipe is gone', async () => {
    await renderRecipes({ route: '/recipes?recipe=deleted-one' });

    expect(await screen.findByText(/no longer in the library/i)).toBeInTheDocument();
  });

  it('marks the ingredients already in the kitchen', async () => {
    await renderRecipes({
      route: '/recipes?recipe=r1',
      items: [makeItem({ name: 'Salmon', normalized: 'salmon' })],
    });

    const row = (await screen.findByText('2 fillet salmon')).closest('.list-group-item');
    expect(within(row).getByText(/in your kitchen/i)).toBeInTheDocument();
  });

  it('does not claim to have an ingredient the kitchen lacks', async () => {
    await renderRecipes({
      route: '/recipes?recipe=r1',
      items: [makeItem({ name: 'Salmon', normalized: 'salmon' })],
    });

    const row = (await screen.findByText('1 tbsp capers')).closest('.list-group-item');
    expect(within(row).queryByText(/in your kitchen/i)).not.toBeInTheDocument();
  });

  it('tells the cook where missing instructions will come from', async () => {
    await renderRecipes({ route: '/recipes?recipe=r2' });

    expect(await screen.findByText(/no instructions yet/i)).toBeInTheDocument();
  });
});

describe('Recipes page — cooking', () => {
  it('records a cook from the detail view', async () => {
    const { user } = await renderRecipes({ route: '/recipes?recipe=r1' });

    await user.click(await screen.findByRole('button', { name: /i cooked this/i }));

    await waitFor(() => expect(fs.updateDoc).toHaveBeenCalled());
    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe('recipes/r1');
    expect(patch.timesCooked).toEqual({ __sentinel: 'increment', by: 1 });
  });

  it('records a cook straight from the grid', async () => {
    const { user } = await renderRecipes();

    await user.click(screen.getByRole('button', { name: /I cooked Sheet Pan Salmon/i }));

    await waitFor(() => expect(fs.updateDoc).toHaveBeenCalled());
  });

  it('surfaces a failure rather than silently doing nothing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.updateDoc.mockRejectedValueOnce(new Error('offline'));
    const { user } = await renderRecipes();

    await user.click(screen.getByRole('button', { name: /I cooked Sheet Pan Salmon/i }));

    expect(await screen.findByText(/couldn.t record that cook/i)).toBeInTheDocument();
  });
});

describe('Recipes page — creating', () => {
  it('adds a recipe through the modal', async () => {
    const { user } = await renderRecipes();

    await user.click(screen.getAllByRole('button', { name: /add recipe/i })[0]);

    const modal = await screen.findByRole('dialog');
    await user.type(within(modal).getByPlaceholderText(/Sheet Pan Salmon/), 'Weeknight Pasta');
    await user.type(within(modal).getByLabelText('Ingredient 1 name'), 'pasta');
    await user.type(within(modal).getByLabelText('Step 1'), 'Boil the pasta.');
    await user.click(within(modal).getByRole('button', { name: 'Add Recipe' }));

    await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
    const [ref, payload] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe('recipes');
    expect(payload).toMatchObject({
      name: 'Weeknight Pasta',
      source: 'user-created',
      timesCooked: 0,
    });
  });
});

describe('Recipes page — editing', () => {
  it('edits a recipe the user created', async () => {
    const { user } = await renderRecipes();

    await user.click(screen.getByRole('button', { name: /Edit Sheet Pan Salmon/i }));

    const modal = await screen.findByRole('dialog');
    const servings = within(modal).getByLabelText('Servings');
    await user.clear(servings);
    await user.type(servings, '8');
    await user.click(within(modal).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(fs.updateDoc).toHaveBeenCalled());
    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe('recipes/r1');
    expect(patch.servings).toBe(8);
    expect(patch).not.toHaveProperty('name');
  });

  it('offers no edit control for a recipe the user did not create', async () => {
    await renderRecipes();

    expect(screen.queryByRole('button', { name: /Edit Grandma Chili/i })).not.toBeInTheDocument();
  });
});

describe('Recipes page — deleting', () => {
  const confirmDelete = async (user) => {
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
  };

  it('asks before deleting', async () => {
    const { user } = await renderRecipes();

    await user.click(screen.getByRole('button', { name: /Delete Sheet Pan Salmon/i }));

    expect(await screen.findByText(/Delete "Sheet Pan Salmon"\?/)).toBeInTheDocument();
    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });

  it('deletes once confirmed', async () => {
    const { user } = await renderRecipes();

    await user.click(screen.getByRole('button', { name: /Delete Sheet Pan Salmon/i }));
    await confirmDelete(user);

    await waitFor(() => expect(fs.deleteDoc).toHaveBeenCalled());
    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe('recipes/r1');
  });

  it('returns to the library after deleting from the detail view', async () => {
    const { user } = await renderRecipes({ route: '/recipes?recipe=r1' });

    await user.click(await screen.findByRole('button', { name: /delete/i }));
    await confirmDelete(user);

    await waitFor(() => expect(fs.deleteDoc).toHaveBeenCalled());
    expect(await screen.findByText('Grandma Chili')).toBeInTheDocument();
  });

  it('explains a refused delete instead of failing quietly', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.deleteDoc.mockRejectedValueOnce(new Error('permission-denied'));
    const { user } = await renderRecipes();

    await user.click(screen.getByRole('button', { name: /Delete Sheet Pan Salmon/i }));
    await confirmDelete(user);

    expect(await screen.findByText(/couldn.t delete that recipe/i)).toBeInTheDocument();
  });
});

describe('Recipes page — legacy sync', () => {
  it('opens the sync dashboard', async () => {
    const { user } = await renderRecipes();

    await user.click(screen.getByRole('button', { name: /legacy sync/i }));

    expect(await screen.findByText(/legacy recipe sync/i)).toBeInTheDocument();
  });
});

describe('Recipes page — failures', () => {
  it('shows a load failure rather than an empty library', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await renderRecipes();

    await act(async () => {
      fs.__emitError('recipes', new Error('permission-denied'));
    });

    expect(screen.getByText(/couldn.t load your recipes/i)).toBeInTheDocument();
  });
});
