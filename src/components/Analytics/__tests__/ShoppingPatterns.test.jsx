// The page-level assembly. The three states that matter are: no history at all,
// history but no prices, and the full picture.

import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('recharts', () => require('../../../test-utils/rechartsMock')());

import ShoppingPatterns from '../ShoppingPatterns';

const analytics = (overrides = {}) => ({
  loading: false,
  error: null,
  totals: {
    itemsTracked: 2,
    purchases: 5,
    spend: 48.25,
    pricedPurchases: 4,
    averagePrice: 12.06,
    storesUsed: 2,
  },
  frequentItems: [
    {
      key: 'milk',
      name: 'Milk',
      purchases: 3,
      spend: 16,
      averagePrice: 5.33,
      bestStore: 'Aldi',
      bestPrice: 4,
    },
  ],
  stores: [{ store: 'Aldi', purchases: 3, spend: 16, averagePrice: 5.33 }],
  monthlySpend: [
    { key: '2026-07', label: 'Jul', spend: 30, purchases: 3 },
    { key: '2026-08', label: 'Aug', spend: 18.25, purchases: 1 },
  ],
  hasPurchaseData: true,
  hasPriceData: true,
  hasStoreData: true,
  ...overrides,
});

describe('ShoppingPatterns', () => {
  it('says it is working rather than claiming there is no data', () => {
    render(<ShoppingPatterns analytics={analytics({ loading: true })} />);

    expect(screen.getByText('Working out your shopping patterns…')).toBeInTheDocument();
    expect(screen.queryByText('No shopping history yet')).not.toBeInTheDocument();
  });

  it('explains how to get started when nothing has been bought', () => {
    render(
      <ShoppingPatterns
        analytics={analytics({
          hasPurchaseData: false,
          hasPriceData: false,
          hasStoreData: false,
          frequentItems: [],
          stores: [],
        })}
      />
    );

    expect(screen.getByText('No shopping history yet')).toBeInTheDocument();
    expect(screen.getByText(/add a price and a store/i)).toBeInTheDocument();
  });

  it('survives being handed nothing at all', () => {
    render(<ShoppingPatterns />);

    expect(screen.getByText('No shopping history yet')).toBeInTheDocument();
  });

  it('leads with the total spend as the one hero number', () => {
    const { container } = render(<ShoppingPatterns analytics={analytics()} />);

    expect(container.querySelectorAll('.shopping-patterns__hero-value')).toHaveLength(1);
    expect(screen.getByText('$48.25')).toBeInTheDocument();
    expect(screen.getByText('across 4 priced purchases')).toBeInTheDocument();
  });

  it('renders all four panels once there is data', () => {
    render(<ShoppingPatterns analytics={analytics()} />);

    expect(screen.getByRole('heading', { name: 'Bought most often' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Grocery spend by month' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Spend by store' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your regulars' })).toBeInTheDocument();
  });

  it('shows the summary numbers', () => {
    render(<ShoppingPatterns analytics={analytics()} />);

    expect(screen.getByText('Purchases logged')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('$12.06')).toBeInTheDocument();
    expect(screen.getByText('Stores shopped')).toBeInTheDocument();
  });

  it('says "Store shopped" when there is only one', () => {
    render(
      <ShoppingPatterns
        analytics={analytics({ totals: { ...analytics().totals, storesUsed: 1 } })}
      />
    );

    expect(screen.getByText('Store shopped')).toBeInTheDocument();
  });

  it('still ranks favourites when no price was ever recorded, and says why', () => {
    render(
      <ShoppingPatterns
        analytics={analytics({
          hasPriceData: false,
          totals: { ...analytics().totals, spend: 0, pricedPurchases: 0, averagePrice: null },
        })}
      />
    );

    expect(screen.getByText(/add a price when you add an item/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bought most often' })).toBeInTheDocument();
    // The money chart shows its own empty state rather than a flat zero line.
    expect(screen.getByText(/record a price when you add an item/i)).toBeInTheDocument();
  });

  it('warns about a partial read without hiding the numbers it does have', () => {
    render(<ShoppingPatterns analytics={analytics({ error: 'Failed to load inventory' })} />);

    expect(
      screen.getByText(/failed to load inventory\. figures may be incomplete/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bought most often' })).toBeInTheDocument();
  });

  it('surfaces the error on the empty state too', () => {
    render(
      <ShoppingPatterns
        analytics={analytics({ error: 'Failed to load inventory', hasPurchaseData: false })}
      />
    );

    expect(screen.getByText('Failed to load inventory.')).toBeInTheDocument();
  });
});
