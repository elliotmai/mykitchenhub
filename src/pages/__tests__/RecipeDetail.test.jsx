// RecipeDetail — the parts an imported recipe brings with it: a description,
// notes, a link back to where it came from, and ingredient lines as written.

import React from 'react';
import { render, screen } from '@testing-library/react';

import RecipeDetail from '../RecipeDetail';
import { makeRecipe } from '../../test-utils/factories';

const renderDetail = (overrides = {}) =>
  render(<RecipeDetail recipe={makeRecipe(overrides)} onBack={jest.fn()} />);

it('shows what a Pestle import carries', () => {
  renderDetail({
    source: 'user-created',
    importedFrom: 'pestle',
    sourceUrl: 'https://www.thekitchn.com',
    description: 'A quick, warming soup.',
    notes: 'Do not boil the miso.\nServe at once.',
    ingredients: [
      { name: 'salt', quantity: 0.5, unit: 'tsp', normalized: 'salt', text: '½ tsp salt' },
      { name: 'water', quantity: 2, unit: 'cups', normalized: 'water' },
    ],
  });

  expect(screen.getByText(/imported from Pestle/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'thekitchn.com' })).toHaveAttribute(
    'href',
    'https://www.thekitchn.com'
  );
  expect(screen.getByText('A quick, warming soup.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
  expect(screen.getByText(/Do not boil the miso/)).toBeInTheDocument();
  expect(screen.getByText('½ tsp salt')).toBeInTheDocument();
  expect(screen.getByText('2 cups water')).toBeInTheDocument();
});

it('leaves the extras out when a recipe has none, and ignores a non-web source link', () => {
  renderDetail({ sourceUrl: 'ftp://example.com/recipe', description: undefined, notes: undefined });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
});

it('shows the original scan, pages in order, and the times as written', () => {
  renderDetail({
    name: 'Apple Cake',
    servingsText: 'One 9×13 pan',
    timesAsWritten: { bake: '45 min at 350' },
    scans: [
      { page: 12, url: 'https://x.test/p12.jpg' },
      { page: 11, url: 'https://x.test/p11.jpg' },
    ],
  });
  expect(screen.getByRole('heading', { name: 'Original scan' })).toBeInTheDocument();
  const pages = screen.getAllByRole('img', { name: /Apple Cake, page/ });
  expect(pages.map((p) => p.getAttribute('src'))).toEqual([
    'https://x.test/p11.jpg',
    'https://x.test/p12.jpg',
  ]);
  expect(pages[0]).toHaveAttribute('loading', 'lazy');
  expect(screen.getByText('One 9×13 pan')).toBeInTheDocument();
  expect(screen.getByText(/As written: bake 45 min at 350/)).toBeInTheDocument();
});

it('offers a recipe photo as the dish cover, and moving to another dish', () => {
  const onUseAsCover = jest.fn();
  const onMoveDish = jest.fn();
  const recipe = makeRecipe({ id: 'r1', name: 'Lasagna', imageUrl: 'https://x.test/l.jpg' });
  const dish = { id: 'lasagna', name: 'Lasagna', recipes: [recipe], coverRecipeId: null };
  render(
    <RecipeDetail
      recipe={recipe}
      onBack={jest.fn()}
      dish={dish}
      onOpenDish={jest.fn()}
      dishes={[dish, { id: 'pasta', name: 'Pasta', recipes: [] }]}
      onMoveDish={onMoveDish}
      onMoveNewDish={jest.fn()}
      onUseAsCover={onUseAsCover}
    />
  );
  screen.getByRole('button', { name: 'Use as dish cover' }).click();
  expect(onUseAsCover).toHaveBeenCalledWith(dish, recipe);
  expect(screen.getByRole('button', { name: 'Dish: Lasagna' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /Move Lasagna/ })).toBeInTheDocument();
});
