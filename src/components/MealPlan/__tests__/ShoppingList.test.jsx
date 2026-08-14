// The shopping list has one job: say what still needs buying, and be honest
// about what the kitchen already has.

import React from 'react';
import { render, screen } from '@testing-library/react';

import ShoppingList from '../ShoppingList';
import BatchCookingTips from '../BatchCookingTips';

const item = (overrides = {}) => ({
  name: 'Salmon',
  normalized: 'salmon',
  quantity: 2,
  unit: 'fillet',
  onHand: 0,
  haveInInventory: false,
  ...overrides,
});

describe('ShoppingList', () => {
  it('explains itself when the week is empty', () => {
    render(<ShoppingList items={[]} />);
    expect(screen.getByText(/Add meals to the week/)).toBeInTheDocument();
  });

  it('lists what to buy, with quantity and unit', () => {
    render(<ShoppingList items={[item()]} />);

    expect(screen.getByText('Salmon')).toBeInTheDocument();
    expect(screen.getByText('2 fillet')).toBeInTheDocument();
  });

  it('counts only the things still to buy', () => {
    render(
      <ShoppingList
        items={[item(), item({ name: 'Rice', normalized: 'rice', haveInInventory: true })]}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('moves covered ingredients into their own section', () => {
    render(<ShoppingList items={[item({ haveInInventory: true })]} />);

    expect(screen.getByText('Already in your kitchen')).toBeInTheDocument();
    expect(screen.getByText(/kitchen already has everything/)).toBeInTheDocument();
  });
});

describe('BatchCookingTips', () => {
  const tip = (overrides = {}) => ({
    group: 'roast-veg',
    title: 'Roast everything at once',
    detail: 'Sunday and Tuesday both roast at 400F.',
    entryDates: ['2026-08-10', '2026-08-12'],
    ...overrides,
  });

  it('renders nothing when there is nothing worth batching', () => {
    const { container } = render(<BatchCookingTips tips={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the tip, why it helps, and which days it covers', () => {
    render(<BatchCookingTips tips={[tip()]} />);

    expect(screen.getByText('Cook once, eat twice')).toBeInTheDocument();
    expect(screen.getByText('Roast everything at once')).toBeInTheDocument();
    expect(screen.getByText(/both roast at 400F/)).toBeInTheDocument();
    expect(screen.getByText('2026-08-10 · 2026-08-12')).toBeInTheDocument();
  });

  it('handles a tip with no days attached', () => {
    render(<BatchCookingTips tips={[tip({ entryDates: [] })]} />);
    expect(screen.getByText('Roast everything at once')).toBeInTheDocument();
  });
});
