// The card is how a user sees "is this food still good?", so the tests are
// written around that question rather than around markup details.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ItemCard from '../ItemCard';
import { makeItem, makeLocation, daysFromNow } from '../../../test-utils/factories';

describe('ItemCard content', () => {
  it('shows the item name, quantity and unit', () => {
    render(<ItemCard item={makeItem({ name: 'Whole Milk', quantity: 2, unit: 'gal' })} />);

    expect(screen.getByText('Whole Milk')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('gal')).toBeInTheDocument();
  });

  it('prefers the location label and icon over the raw location type', () => {
    render(
      <ItemCard
        item={makeItem({ locationType: 'fridge' })}
        location={makeLocation({ label: 'Garage Fridge', icon: '🚗' })}
      />
    );

    expect(screen.getByText('Garage Fridge')).toBeInTheDocument();
    expect(screen.getByText('🚗')).toBeInTheDocument();
  });

  it('falls back to the location type when no location document is supplied', () => {
    render(<ItemCard item={makeItem({ locationType: 'freezer' })} />);
    expect(screen.getByText('freezer')).toBeInTheDocument();
  });

  it('shows notes when present and omits the row when not', () => {
    const { rerender } = render(<ItemCard item={makeItem({ notes: 'opened Tuesday' })} />);
    expect(screen.getByText('opened Tuesday')).toBeInTheDocument();

    rerender(<ItemCard item={makeItem({ notes: '' })} />);
    expect(screen.queryByText('opened Tuesday')).not.toBeInTheDocument();
  });

  it('renders without a unit', () => {
    render(<ItemCard item={makeItem({ name: 'Eggs', quantity: 12, unit: '' })} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});

describe('ItemCard expiration colour-coding', () => {
  it.each([
    ['Expired', -1],
    ['Critical', 1],
    ['Soon', 4],
    ['Fresh', 60],
  ])('badges an item as %s when it expires in %i days', (label, days) => {
    render(<ItemCard item={makeItem({ expiresAt: daysFromNow(days) })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('describes the remaining time in words', () => {
    render(<ItemCard item={makeItem({ expiresAt: daysFromNow(1) })} />);
    expect(screen.getByText('Expires tomorrow')).toBeInTheDocument();
  });

  it('marks expiring items with a status class the stylesheet can target', () => {
    const { container } = render(<ItemCard item={makeItem({ expiresAt: daysFromNow(-2) })} />);
    expect(container.querySelector('.expiration-critical')).toBeInTheDocument();
  });

  it.each([
    ['an expired', -1, /check it before you cook/i],
    ['a critical', 1, /freeze/i],
  ])('tells the cook what to do about %s item', (_label, days, advice) => {
    render(<ItemCard item={makeItem({ expiresAt: daysFromNow(days) })} />);

    const warning = screen.getByTestId('expiration-warning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent(advice);
  });

  it.each([
    ['soon', 4],
    ['fresh', 60],
  ])('stays quiet about a %s item, so the warnings mean something', (_label, days) => {
    render(<ItemCard item={makeItem({ expiresAt: daysFromNow(days) })} />);
    expect(screen.queryByTestId('expiration-warning')).not.toBeInTheDocument();
  });

  it('treats an item with no expiry as fresh instead of erroring', () => {
    render(<ItemCard item={makeItem({ expiresAt: null })} />);
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('No expiry')).toBeInTheDocument();
  });
});

describe('ItemCard actions', () => {
  it('passes the whole item to onEdit', async () => {
    const onEdit = jest.fn();
    const item = makeItem({ name: 'Milk' });
    render(<ItemCard item={item} onEdit={onEdit} />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(onEdit).toHaveBeenCalledWith(item);
  });

  it('passes the whole item to onDelete', async () => {
    const onDelete = jest.fn();
    const item = makeItem({ name: 'Milk' });
    const { container } = render(<ItemCard item={item} onDelete={onDelete} />);

    const buttons = container.querySelectorAll('button');
    await userEvent.click(buttons[buttons.length - 1]);

    expect(onDelete).toHaveBeenCalledWith(item);
  });

  it('does not crash when no handlers are wired up', async () => {
    render(<ItemCard item={makeItem()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });
});
