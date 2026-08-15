// The three charts, plus the frame they share.
//
// Assertions lean on the table view rather than on SVG paths: the table is the
// contract with the reader (and with a screen reader), so if it is right the
// numbers are right.

import React from 'react';
import { render, screen, within } from '@testing-library/react';

jest.mock('recharts', () => require('../../../test-utils/rechartsMock')());

import ChartFrame from '../ChartFrame';
import TopItemsChart, { truncateName } from '../TopItemsChart';
import SpendTrendChart, { LastPointLabel } from '../SpendTrendChart';
import StoreChart from '../StoreChart';
import FrequentItemsTable from '../FrequentItemsTable';

const item = (overrides = {}) => ({
  key: 'milk',
  name: 'Milk',
  purchases: 3,
  spend: 16,
  averagePrice: 5.33,
  bestStore: 'Aldi',
  bestPrice: 4,
  unit: 'gal',
  lastPurchased: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// ChartFrame
// ---------------------------------------------------------------------------

describe('ChartFrame', () => {
  it('shows the empty message instead of an axis-less plot', () => {
    render(
      <ChartFrame title="Spend" isEmpty emptyMessage="Nothing yet.">
        <div data-testid="plot" />
      </ChartFrame>
    );

    expect(screen.getByText('Nothing yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('plot')).not.toBeInTheDocument();
  });

  it('hides the plot from assistive tech and offers the table instead', () => {
    const { container } = render(
      <ChartFrame title="Spend" tableColumns={['Month', 'Spend']} tableRows={[['Aug', '$3.00']]}>
        <div data-testid="plot" />
      </ChartFrame>
    );

    expect(container.querySelector('.chart-frame__plot')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('View as table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Month' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '$3.00' })).toBeInTheDocument();
  });

  it('skips the table when no columns are given', () => {
    render(
      <ChartFrame title="Spend">
        <div data-testid="plot" />
      </ChartFrame>
    );

    expect(screen.queryByText('View as table')).not.toBeInTheDocument();
  });

  it('renders the subtitle when there is one', () => {
    render(<ChartFrame title="Spend" subtitle="last 6 months" isEmpty />);

    expect(screen.getByText('last 6 months')).toBeInTheDocument();
  });

  it('keeps both rows distinct when two share a first cell', () => {
    // Keyed on the first cell alone, two rows named "Milk" are one key to
    // React — which warns, and is free to reuse the wrong row on an update.
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ChartFrame
        title="Spend"
        tableColumns={['Item', 'Spend']}
        tableRows={[
          ['Milk', '$3.00'],
          ['Milk', '$4.00'],
        ]}
      />
    );

    expect(screen.getAllByRole('rowheader', { name: 'Milk' })).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '$4.00' })).toBeInTheDocument();
    const duplicateKeyWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes('two children with the same key')
    );
    warn.mockRestore();

    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it('opens from the keyboard, since the plot itself is hidden from it', () => {
    render(
      <ChartFrame title="Spend" tableColumns={['Month', 'Spend']} tableRows={[['Aug', '$3.00']]}>
        <div data-testid="plot" />
      </ChartFrame>
    );

    const summary = screen.getByText('View as table');
    // <summary> is focusable and Enter-activated natively; what matters is that
    // it really is a summary inside a details, not a div wearing the label.
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')).not.toBeNull();

    summary.closest('details').open = true;
    expect(screen.getByRole('columnheader', { name: 'Month' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// TopItemsChart
// ---------------------------------------------------------------------------

describe('truncateName', () => {
  it('leaves a short name alone', () => {
    expect(truncateName('Milk')).toBe('Milk');
  });

  it('ellipsises a name that would eat the plot', () => {
    const short = truncateName('Boneless skinless chicken thighs', 10);

    expect(short).toHaveLength(10);
    expect(short).toContain('…');
  });

  it('keeps the end of the name, which is what tells two apart', () => {
    // Cutting only the tail leaves these two reading identically on the axis.
    const downtown = truncateName('Whole Foods Market Downtown', 16);
    const uptown = truncateName('Whole Foods Market Uptown', 16);

    expect(downtown).not.toBe(uptown);
    expect(downtown).toContain('owntown');
    expect(uptown).toContain('Uptown');
  });

  it('copes with a missing name', () => {
    expect(truncateName(undefined)).toBe('');
    expect(truncateName(null)).toBe('');
  });

  it('leaves a name exactly at the limit alone', () => {
    expect(truncateName('123456789012345678')).toBe('123456789012345678');
  });
});

describe('TopItemsChart', () => {
  it('draws a bar per item and lists them in the table', () => {
    const { container } = render(
      <TopItemsChart
        items={[item(), item({ key: 'rice', name: 'Rice', purchases: 2, averagePrice: 2.1 })]}
      />
    );

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Milk' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '3 times' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '$5.33' })).toBeInTheDocument();
  });

  it('says what to do about it when nothing has been bought yet', () => {
    render(<TopItemsChart items={[]} />);

    expect(
      screen.getByText(/add a few items to your inventory and your regulars will show up/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a dash in the table for an item with no recorded price', () => {
    render(<TopItemsChart items={[item({ averagePrice: null })]} />);

    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument();
  });

  it('gives two long names their own row instead of stacking them on one', () => {
    // A category axis merges equal categories, so two names that shorten to the
    // same string used to share a band — and the axis said the same thing twice.
    const { container } = render(
      <TopItemsChart
        items={[
          item({ key: 'thighs-boneless', name: 'Chicken thighs boneless', purchases: 5 }),
          item({ key: 'thighs-bone-in', name: 'Chicken thighs bone-in', purchases: 3 }),
        ]}
      />
    );

    const ticks = [
      ...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value'),
    ].map((t) => t.textContent);

    expect(ticks).toHaveLength(2);
    expect(new Set(ticks).size).toBe(2);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
  });

  it('still lists both rows in the table when their names are identical', () => {
    // Two documents can share a display name and differ only in their key. The
    // axis is keyed on the key for exactly this reason: keyed on the label,
    // recharts folds both into one band and draws one bar for two ingredients.
    const { container } = render(
      <TopItemsChart
        items={[
          item({ key: 'milk-whole', name: 'Milk', purchases: 4 }),
          item({ key: 'milk-oat', name: 'Milk', purchases: 2 }),
        ]}
      />
    );

    expect(screen.getAllByRole('rowheader', { name: 'Milk' })).toHaveLength(2);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
  });

  it('draws a single item without collapsing the plot', () => {
    const { container } = render(<TopItemsChart items={[item({ purchases: 1 })]} />);

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(1);
    expect(screen.getByRole('cell', { name: '1 time' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SpendTrendChart
// ---------------------------------------------------------------------------

describe('LastPointLabel', () => {
  it('labels only the final point', () => {
    const { container } = render(
      <svg>
        <LastPointLabel x={10} y={20} value={12.5} index={2} lastIndex={2} />
      </svg>
    );

    expect(container.querySelector('text')).toHaveTextContent('$12.50');
  });

  it('renders nothing for the points in between', () => {
    const { container } = render(
      <svg>
        <LastPointLabel x={10} y={20} value={12.5} index={0} lastIndex={2} />
      </svg>
    );

    expect(container.querySelector('text')).toBeNull();
  });
});

describe('SpendTrendChart', () => {
  const months = [
    { key: '2026-07', label: 'Jul', spend: 15.5, purchases: 2 },
    { key: '2026-08', label: 'Aug', spend: 3, purchases: 1 },
  ];

  it('plots one line and tabulates the months behind it', () => {
    const { container } = render(<SpendTrendChart months={months} />);

    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Jul' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '$15.50' })).toBeInTheDocument();
  });

  it('explains the blank rather than drawing a flat zero line', () => {
    render(<SpendTrendChart months={[]} />);

    expect(screen.getByText(/record a price when you add an item/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StoreChart
// ---------------------------------------------------------------------------

describe('StoreChart', () => {
  const stores = [
    { store: 'Costco', purchases: 2, spend: 50, averagePrice: 25 },
    { store: 'Aldi', purchases: 1, spend: 10, averagePrice: 10 },
  ];

  it('draws a bar per store with the money in the table', () => {
    const { container } = render(<StoreChart stores={stores} />);

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Costco' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '$50.00' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '$25.00' })).toBeInTheDocument();
  });

  it('asks for store names when none were recorded', () => {
    render(<StoreChart stores={[]} />);

    expect(screen.getByText(/note the store when you add an item/i)).toBeInTheDocument();
  });

  it('tells two branches of the same chain apart on the axis', () => {
    const { container } = render(
      <StoreChart
        stores={[
          { store: 'Whole Foods Market Downtown', purchases: 2, spend: 50, averagePrice: 25 },
          { store: 'Whole Foods Market Uptown', purchases: 1, spend: 10, averagePrice: 10 },
        ]}
      />
    );

    const ticks = [
      ...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value'),
    ].map((t) => t.textContent);

    expect(ticks).toHaveLength(2);
    expect(new Set(ticks).size).toBe(2);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);

    // The table keeps the full names, however the axis shortened them.
    expect(
      screen.getByRole('rowheader', { name: 'Whole Foods Market Downtown' })
    ).toBeInTheDocument();
  });

  it('draws one store without a degenerate axis', () => {
    const { container } = render(
      <StoreChart stores={[{ store: 'Aldi', purchases: 1, spend: 10, averagePrice: 10 }]} />
    );

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(1);
    expect(screen.getByRole('rowheader', { name: 'Aldi' })).toBeInTheDocument();
  });

  it('shows a store that has trips but no prices as zero rather than as blank', () => {
    render(<StoreChart stores={[{ store: 'Aldi', purchases: 3, spend: 0, averagePrice: null }]} />);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('cell', { name: '$0.00' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '3' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '—' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FrequentItemsTable
// ---------------------------------------------------------------------------

describe('FrequentItemsTable', () => {
  it('shows what each regular costs and where it was cheapest', () => {
    render(<FrequentItemsTable items={[item()]} />);

    expect(screen.getByRole('rowheader', { name: 'Milk' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '3 times' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '$5.33' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /Aldi/ })).toHaveTextContent('$4.00');
  });

  it('says so plainly when no store was recorded', () => {
    render(<FrequentItemsTable items={[item({ bestStore: null, bestPrice: null })]} />);

    expect(screen.getByText('No store recorded')).toBeInTheDocument();
  });

  it('renders an empty state rather than a headers-only table', () => {
    render(<FrequentItemsTable items={[]} />);

    expect(screen.getByText(/nothing tracked yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
