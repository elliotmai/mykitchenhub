// A stat tile is the smallest thing on the dashboard and the easiest to get
// subtly wrong: a stale zero while data is still arriving reads as "your kitchen
// is empty", which is a lie.

import React from 'react';
import { Package } from 'lucide-react';
import { renderWithProviders, screen } from '../../../test-utils';
import StatCard, { formatStatValue } from '../StatCard';

describe('formatStatValue', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1K'],
    [1200, '1.2K'],
    [15000, '15K'],
    [2000000, '2M'],
    [2400000, '2.4M'],
  ])('renders %p as %p', (value, expected) => {
    expect(formatStatValue(value)).toBe(expected);
  });

  it('passes an already-formatted string straight through', () => {
    expect(formatStatValue('$12.99')).toBe('$12.99');
  });

  it.each([[null], [undefined], [NaN], [Infinity]])('renders %p as a dash', (value) => {
    expect(formatStatValue(value)).toBe('—');
  });
});

describe('StatCard', () => {
  it('shows the value and its label', () => {
    renderWithProviders(<StatCard label="Total Items" value={12} icon={Package} />);

    expect(screen.getByTestId('stat-card-value')).toHaveTextContent('12');
    expect(screen.getByText('Total Items')).toBeInTheDocument();
  });

  it('shows a dash while loading rather than a misleading zero', () => {
    renderWithProviders(<StatCard label="Total Items" value={0} loading />);

    expect(screen.getByTestId('stat-card-value')).toHaveTextContent('—');
  });

  it('renders a real zero once loading is done', () => {
    renderWithProviders(<StatCard label="Total Items" value={0} />);

    expect(screen.getByTestId('stat-card-value')).toHaveTextContent('0');
  });

  it('links to the page behind the number when given a route', () => {
    renderWithProviders(<StatCard label="Recipes" value={3} to="/recipes" />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/recipes');
  });

  it('is not a link without a route', () => {
    renderWithProviders(<StatCard label="Recipes" value={3} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the optional hint', () => {
    renderWithProviders(<StatCard label="Expiring Soon" value={2} hint="within 5 days" />);

    expect(screen.getByText('within 5 days')).toBeInTheDocument();
  });

  it('carries the tone through to the icon chip, so colour is never the only cue', () => {
    const { container } = renderWithProviders(
      <StatCard label="Expiring Soon" value={2} icon={Package} tone="warning" />
    );

    expect(container.querySelector('.stat-card__icon--warning')).toBeInTheDocument();
    // The icon is decorative: the label already says what the number is.
    expect(container.querySelector('.stat-card__icon')).toHaveAttribute('aria-hidden', 'true');
  });
});
