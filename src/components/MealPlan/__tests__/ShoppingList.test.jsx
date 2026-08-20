// The shopping list has one job: say what still needs buying, and be honest
// about what the kitchen already has.

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ShoppingList, { amountLabel } from '../ShoppingList';
import BatchCookingTips from '../BatchCookingTips';
import { makeShoppingItem } from '../../../test-utils/factories';

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

// ---------------------------------------------------------------------------
// The manual half of the list
//
// Two kinds of row from two different places. The derived ones are computed
// fresh on every render and stored nowhere; the manual ones are documents. The
// tests below are mostly about not confusing the two.
// ---------------------------------------------------------------------------

describe('manual items', () => {
  const handlers = (overrides = {}) => ({
    onAddItem: jest.fn().mockResolvedValue({ success: true }),
    onToggleBought: jest.fn().mockResolvedValue({ success: true }),
    onRemoveItem: jest.fn().mockResolvedValue({ success: true }),
    onClearBought: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  });

  it('files an item with no haveInInventory under "to buy", never under "already have"', () => {
    // The failure this exists to stop: a manual item carries no
    // needed-versus-on-hand comparison, so the field is absent — and an absent
    // field must not read as "the kitchen has it". That would quietly drop
    // batteries out of the only list they appear on.
    render(
      <ShoppingList manualItems={[makeShoppingItem({ name: 'Batteries' })]} {...handlers()} />
    );

    expect(screen.getByText('Batteries')).toBeInTheDocument();
    expect(screen.queryByText('Already in your kitchen')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Tick Batteries off' })).not.toBeChecked();
  });

  it('does the same for a derived row whose haveInInventory never got set', () => {
    const { haveInInventory, ...withoutFlag } = item({ name: 'Salmon' });
    render(<ShoppingList items={[withoutFlag]} />);

    expect(screen.getByText('Salmon')).toBeInTheDocument();
    expect(screen.queryByText('Already in your kitchen')).not.toBeInTheDocument();
  });

  it('shows typed items alongside the ones the week needs', () => {
    render(
      <ShoppingList
        items={[item({ name: 'Salmon' })]}
        manualItems={[makeShoppingItem({ name: 'Batteries' })]}
        {...handlers()}
      />
    );

    expect(screen.getByText('Salmon')).toBeInTheDocument();
    expect(screen.getByText('Batteries')).toBeInTheDocument();
    // Both count as still to buy.
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('gives only the manual rows something to tick', () => {
    // A derived row has no document, so there is nowhere to record that it was
    // bought. No checkbox is the honest answer.
    render(
      <ShoppingList
        items={[item({ name: 'Salmon' })]}
        manualItems={[makeShoppingItem({ name: 'Batteries' })]}
        {...handlers()}
      />
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Tick Batteries off' })).toBeInTheDocument();
  });

  it('adds what was typed, and empties the boxes afterwards', async () => {
    const user = userEvent.setup();
    const props = handlers();
    render(<ShoppingList {...props} />);

    const nameBox = screen.getByLabelText('Add something to the shopping list');
    await user.type(nameBox, 'Birthday cake');
    await user.type(screen.getByLabelText('How many'), '2');
    await user.type(screen.getByLabelText('Unit'), 'box');
    await user.click(screen.getByRole('button', { name: /add/i }));

    expect(props.onAddItem).toHaveBeenCalledWith({
      name: 'Birthday cake',
      quantity: '2',
      unit: 'box',
    });
    await waitFor(() => expect(nameBox).toHaveValue(''));
  });

  it('keeps what was typed when the write is refused', async () => {
    const user = userEvent.setup();
    const props = handlers({ onAddItem: jest.fn().mockResolvedValue({ success: false }) });
    render(<ShoppingList {...props} />);

    const nameBox = screen.getByLabelText('Add something to the shopping list');
    await user.type(nameBox, 'Batteries');
    await user.click(screen.getByRole('button', { name: /add/i }));

    // Retyping it as well as being told no is two punishments for one failure.
    await waitFor(() => expect(props.onAddItem).toHaveBeenCalled());
    expect(nameBox).toHaveValue('Batteries');
  });

  it('will not submit an empty line', async () => {
    const user = userEvent.setup();
    const props = handlers();
    render(<ShoppingList {...props} />);

    const add = screen.getByRole('button', { name: /add/i });
    expect(add).toBeDisabled();

    await user.type(screen.getByLabelText('Add something to the shopping list'), '   ');
    expect(add).toBeDisabled();
    expect(props.onAddItem).not.toHaveBeenCalled();
  });

  it('ticks an item off rather than deleting it', async () => {
    const user = userEvent.setup();
    const props = handlers();
    const batteries = makeShoppingItem({ id: 'shop-1', name: 'Batteries' });
    render(<ShoppingList manualItems={[batteries]} {...props} />);

    await user.click(screen.getByRole('checkbox', { name: 'Tick Batteries off' }));

    expect(props.onToggleBought).toHaveBeenCalledWith(batteries, true);
    expect(props.onRemoveItem).not.toHaveBeenCalled();
  });

  it('moves a bought item into the trolley, and offers it back', async () => {
    const user = userEvent.setup();
    const props = handlers();
    const roll = makeShoppingItem({ id: 'shop-2', name: 'Kitchen roll', status: 'bought' });
    render(<ShoppingList manualItems={[roll]} {...props} />);

    expect(screen.getByText('In the trolley')).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: 'Put Kitchen roll back on the list' });
    expect(box).toBeChecked();

    await user.click(box);
    expect(props.onToggleBought).toHaveBeenCalledWith(roll, false);
  });

  it('counts a bought item as no longer outstanding', () => {
    render(
      <ShoppingList
        manualItems={[
          makeShoppingItem({ id: 'shop-1', name: 'Batteries' }),
          makeShoppingItem({ id: 'shop-2', name: 'Kitchen roll', status: 'bought' }),
        ]}
        {...handlers()}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('clears the trolley on request', async () => {
    const user = userEvent.setup();
    const props = handlers();
    render(
      <ShoppingList
        manualItems={[makeShoppingItem({ name: 'Kitchen roll', status: 'bought' })]}
        {...props}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(props.onClearBought).toHaveBeenCalled();
  });

  it('removes an item outright', async () => {
    const user = userEvent.setup();
    const props = handlers();
    const batteries = makeShoppingItem({ id: 'shop-1', name: 'Batteries' });
    render(<ShoppingList manualItems={[batteries]} {...props} />);

    await user.click(screen.getByRole('button', { name: 'Remove Batteries' }));
    expect(props.onRemoveItem).toHaveBeenCalledWith(batteries);
  });

  it('says when the week needs the same thing, instead of merging the two', () => {
    // Merging is not obviously right: a typed "1" means a bottle and a derived
    // "200 g" came out of a recipe, so one number cannot be both.
    render(
      <ShoppingList
        items={[item({ name: 'Milk', normalized: 'milk', quantity: 200, unit: 'g' })]}
        manualItems={[makeShoppingItem({ name: 'Milk' })]}
        duplicateNames={new Set(['milk'])}
        {...handlers()}
      />
    );

    expect(screen.getByText(/this week’s meals need it too/)).toBeInTheDocument();
    // Still two rows, with the quantities they each came with.
    expect(screen.getAllByText('Milk')).toHaveLength(2);
    expect(screen.getByText('200 g')).toBeInTheDocument();
  });

  it('does not label a typed item nothing else asked for', () => {
    render(
      <ShoppingList
        items={[item({ name: 'Salmon' })]}
        manualItems={[makeShoppingItem({ name: 'Batteries' })]}
        duplicateNames={new Set()}
        {...handlers()}
      />
    );

    expect(screen.queryByText(/meals need it too/)).not.toBeInTheDocument();
  });

  it('leaves out a bare "1" that tells the cook nothing', () => {
    render(
      <ShoppingList manualItems={[makeShoppingItem({ name: 'Batteries' })]} {...handlers()} />
    );

    // Scoped to the row: the outstanding-count badge is also a "1", and it has
    // every right to be.
    const row = screen.getByText('Batteries').closest('li');
    expect(within(row).queryByText('1')).not.toBeInTheDocument();
  });

  it('shows an amount worth reading', () => {
    render(
      <ShoppingList
        manualItems={[makeShoppingItem({ name: 'Milk', quantity: 2, unit: 'l' })]}
        {...handlers()}
      />
    );
    expect(screen.getByText('2 l')).toBeInTheDocument();
  });

  it('shows the note a cook left on an item', () => {
    render(
      <ShoppingList
        manualItems={[makeShoppingItem({ name: 'Cake', notes: 'the chocolate one' })]}
        {...handlers()}
      />
    );
    expect(screen.getByText('the chocolate one')).toBeInTheDocument();
  });

  it('holds a row still while its write is in flight', () => {
    render(
      <ShoppingList
        manualItems={[makeShoppingItem({ id: 'shop-1', name: 'Batteries' })]}
        busyItemId="shop-1"
        {...handlers()}
      />
    );

    expect(screen.getByRole('checkbox', { name: 'Tick Batteries off' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Batteries' })).toBeDisabled();
  });

  it('invites a cook to type something when there is nothing at all', () => {
    render(<ShoppingList items={[]} manualItems={[]} {...handlers()} />);
    expect(screen.getByText(/type anything else you need/)).toBeInTheDocument();
  });

  it('does not claim the kitchen has everything when only typed items remain', () => {
    // "Your kitchen already has everything this week needs" is about the week's
    // meals. With no meals on the board it would be a non-sequitur.
    render(
      <ShoppingList
        items={[]}
        manualItems={[makeShoppingItem({ name: 'Kitchen roll', status: 'bought' })]}
        {...handlers()}
      />
    );

    expect(screen.getByText('Nothing left to buy.')).toBeInTheDocument();
    expect(screen.queryByText(/kitchen already has everything/)).not.toBeInTheDocument();
  });

  it('renders exactly what it always did when no handlers are passed', () => {
    // The derived-only caller must be unaffected: no form, no checkboxes.
    render(<ShoppingList items={[item()]} />);

    expect(screen.queryByLabelText('Add something to the shopping list')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('Salmon')).toBeInTheDocument();
  });
});

describe('amountLabel', () => {
  it('says nothing for one of something unmeasured', () => {
    expect(amountLabel({ quantity: 1, unit: '' })).toBeNull();
  });

  it('keeps a count that means something', () => {
    expect(amountLabel({ quantity: 6, unit: '' })).toBe('6');
    expect(amountLabel({ quantity: 1, unit: 'box' })).toBe('1 box');
    expect(amountLabel({ quantity: 2, unit: 'l' })).toBe('2 l');
  });

  it('falls back to the unit when there is no number', () => {
    expect(amountLabel({ quantity: 0, unit: 'bunch' })).toBe('bunch');
    expect(amountLabel({})).toBeNull();
  });
});
