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

// ---------------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------------

describe('what the kitchen already has', () => {
  it('says how much of a partly-stocked item is in stock', () => {
    render(<ShoppingList items={[item({ quantity: 5, unit: 'cup', onHand: 2 })]} />);

    // Buying five cups when two are already in the jar is two cups wasted.
    expect(screen.getByText(/2 cup in stock/)).toBeInTheDocument();
  });

  it('stays quiet when the kitchen has none of it', () => {
    render(<ShoppingList items={[item({ quantity: 5, unit: 'cup', onHand: 0 })]} />);
    expect(screen.queryByText(/in stock/)).not.toBeInTheDocument();
  });

  it('flags stock recorded in a unit the recipe does not use', () => {
    render(
      <ShoppingList
        items={[
          item({
            quantity: 1,
            unit: 'fillet',
            onHand: 0,
            otherUnits: [{ quantity: 4, unit: 'gal' }],
          }),
        ]}
      />
    );

    // Four gallons of salmon do not cover a fillet, but the cook should still
    // know the salmon is in there before buying more.
    expect(screen.getByText(/4 gal in stock — different measure/)).toBeInTheDocument();
  });

  it('keeps the same ingredient in two units as two lines', () => {
    render(
      <ShoppingList
        items={[
          item({ key: 'flour|cup', name: 'Flour', normalized: 'flour', quantity: 2, unit: 'cup' }),
          item({ key: 'flour|g', name: 'Flour', normalized: 'flour', quantity: 200, unit: 'g' }),
        ]}
      />
    );

    expect(screen.getByText('2 cup')).toBeInTheDocument();
    expect(screen.getByText('200 g')).toBeInTheDocument();
  });
});

describe('BatchCookingTips keys', () => {
  it('renders two stored tips that share a group', () => {
    render(
      <BatchCookingTips
        tips={[
          { key: 'ai-0', group: '', title: 'Roast it all', detail: 'One tray.' },
          { key: 'ai-1', group: '', title: 'Chop it all', detail: 'One board.' },
        ]}
      />
    );

    expect(screen.getByText('Roast it all')).toBeInTheDocument();
    expect(screen.getByText('Chop it all')).toBeInTheDocument();
  });
});
