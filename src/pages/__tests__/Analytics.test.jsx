// The Analytics page is thin — it wires the hook to the component — so this
// checks the wiring end to end against a mocked Firestore.

import React from 'react';
import { act, waitFor, within } from '@testing-library/react';

jest.mock('recharts', () => require('../../test-utils/rechartsMock')());

import { renderWithProviders, screen, firestoreMock as fs } from '../../test-utils';
import { asDocs, makeItemWithPurchases, makePurchase } from '../../test-utils/factories';
import Analytics from '../Analytics';

const UID = 'test-uid';
const INVENTORY_PATH = `users/${UID}/inventory`;

const renderAnalytics = async (items = []) => {
  const view = renderWithProviders(<Analytics />, { route: '/analytics' });

  await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBe(1));
  await act(async () => {
    fs.__emit(INVENTORY_PATH, asDocs(items));
  });

  return view;
};

describe('Analytics page', () => {
  it('has a heading and says what the page is for', async () => {
    await renderAnalytics();

    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(
      screen.getByText('What you buy, what it costs, and where you buy it.')
    ).toBeInTheDocument();
  });

  it('explains itself to someone with an empty kitchen', async () => {
    await renderAnalytics();

    expect(screen.getByText('No shopping history yet')).toBeInTheDocument();
  });

  it('turns purchase history into insights', async () => {
    await renderAnalytics([
      makeItemWithPurchases(
        [
          makePurchase({ price: 6, store: 'Aldi' }),
          makePurchase({ price: 4, store: 'Costco' }),
          makePurchase({ price: 5, store: 'Aldi' }),
        ],
        { name: 'Milk', normalized: 'milk' }
      ),
      makeItemWithPurchases([makePurchase({ price: 12, store: 'Costco' })], {
        name: 'Salmon',
        normalized: 'salmon',
      }),
    ]);

    // $6 + $4 + $5 + $12
    expect(document.querySelector('.shopping-patterns__hero-value')).toHaveTextContent('$27.00');
    expect(screen.getByRole('heading', { name: 'Bought most often' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your regulars' })).toBeInTheDocument();

    // Milk averages $5 at Aldi vs $4 at Costco, so Costco is its cheapest.
    const regulars = document.querySelector('.frequent-items__table');
    const milkRow = within(regulars).getByRole('rowheader', { name: 'Milk' }).closest('tr');
    expect(within(milkRow).getByText('3 times')).toBeInTheDocument();
    expect(within(milkRow).getByText('$5.00')).toBeInTheDocument();
    expect(milkRow).toHaveTextContent('Costco');
  });

  it('offers the numbers as a table for anyone who cannot read the charts', async () => {
    await renderAnalytics([
      makeItemWithPurchases([makePurchase({ price: 6, store: 'Aldi' })], {
        name: 'Milk',
        normalized: 'milk',
      }),
    ]);

    expect(screen.getAllByText('View as table').length).toBeGreaterThan(0);
  });
});
