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
