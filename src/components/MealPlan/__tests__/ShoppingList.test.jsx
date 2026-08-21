// The shopping list has one job: say what still needs buying, and be honest
// about what the kitchen already has.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

    expect(screen.getByText('Got it')).toBeInTheDocument();
    expect(screen.getByText(/kitchen already has everything/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Adding, ticking off and removing — roadmap 7.4
// ---------------------------------------------------------------------------

describe('keeping the list', () => {
  it('has nothing to add with when no handler is given', () => {
    render(<ShoppingList items={[item()]} />);
    expect(screen.queryByLabelText(/Add an item/)).not.toBeInTheDocument();
  });

  it('adds what was typed, and clears the box afterwards', async () => {
    const onAdd = jest.fn(async () => ({ success: true }));
    render(<ShoppingList items={[]} onAdd={onAdd} />);

    const box = screen.getByLabelText('Add an item to the shopping list');
    await userEvent.type(box, 'bin bags{enter}');

    expect(onAdd).toHaveBeenCalledWith({ name: 'bin bags' });
    expect(box).toHaveValue('');
  });

  it('keeps what was typed when the write failed, so it is not lost', async () => {
    const onAdd = jest.fn(async () => ({ success: false, error: 'offline' }));
    render(<ShoppingList items={[]} onAdd={onAdd} />);

    const box = screen.getByLabelText('Add an item to the shopping list');
    await userEvent.type(box, 'bin bags{enter}');

    expect(box).toHaveValue('bin bags');
  });

  it('will not add nothing', async () => {
    const onAdd = jest.fn();
    render(<ShoppingList items={[]} onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText('Add an item to the shopping list'), '   {enter}');

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('ticks a row off', async () => {
    const onToggle = jest.fn();
    render(<ShoppingList items={[item({ id: 'a', fromPlan: false })]} onToggle={onToggle} />);

    await userEvent.click(screen.getByLabelText('Got Salmon'));

    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('offers to tick off a meal-plan row too, even though nothing is stored for it yet', async () => {
    const onToggle = jest.fn();
    render(<ShoppingList items={[item({ fromPlan: true })]} onToggle={onToggle} />);

    await userEvent.click(screen.getByLabelText('Got Salmon'));

    expect(onToggle).toHaveBeenCalled();
  });

  it('shows a bought row as done, and offers to put it back', () => {
    render(<ShoppingList items={[item({ id: 'a', status: 'bought' })]} onToggle={jest.fn()} />);

    expect(screen.getByText('Got it')).toBeInTheDocument();
    expect(screen.getByLabelText('Put Salmon back on the list')).toBeChecked();
    // It is no longer something to buy, so it is not in the count.
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('removes only rows that have a document behind them', async () => {
    const onRemove = jest.fn();
    render(
      <ShoppingList
        items={[
          item({ id: 'a', name: 'Bin bags', normalized: 'bin bags', fromPlan: false }),
          item({ name: 'Salmon', fromPlan: true }),
        ]}
        onRemove={onRemove}
      />
    );

    await userEvent.click(screen.getByLabelText('Remove Bin bags'));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));

    // The week's own rows are removed by changing the week, not by a cross here.
    expect(screen.queryByLabelText('Remove Salmon')).not.toBeInTheDocument();
  });

  it('says which rows arrived by voice', () => {
    render(<ShoppingList items={[item({ id: 'a', source: 'alexa', fromPlan: false })]} />);

    expect(screen.getByLabelText('Added by voice')).toBeInTheDocument();
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
