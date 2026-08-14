// The urgent list is the dashboard's whole point: if it silently misses an
// expired item, food gets thrown away.

import React from 'react';
import { renderWithProviders, screen, within } from '../../../test-utils';
import { makeItem, daysFromNow } from '../../../test-utils/factories';
import UrgentAlerts, { buildUrgentAlerts } from '../UrgentAlerts';

describe('buildUrgentAlerts', () => {
  it('picks up expired and use-today items and ignores the rest', () => {
    const alerts = buildUrgentAlerts([
      makeItem({ name: 'Old Yogurt', expiresAt: daysFromNow(-2) }),
      makeItem({ name: 'Fresh Fish', expiresAt: daysFromNow(1) }),
      makeItem({ name: 'Spinach', expiresAt: daysFromNow(4) }),
      makeItem({ name: 'Rice', expiresAt: daysFromNow(90) }),
    ]);

    expect(alerts.map((a) => a.name)).toEqual(['Old Yogurt', 'Fresh Fish']);
  });

  it('puts already-expired items above things merely due today', () => {
    const alerts = buildUrgentAlerts([
      makeItem({ name: 'Fish', expiresAt: daysFromNow(0) }),
      makeItem({ name: 'Yogurt', expiresAt: daysFromNow(-1) }),
    ]);

    expect(alerts.map((a) => a.status)).toEqual(['expired', 'critical']);
  });

  it('sorts the worst-expired first within the same status', () => {
    const alerts = buildUrgentAlerts([
      makeItem({ name: 'Recent', expiresAt: daysFromNow(-1) }),
      makeItem({ name: 'Ancient', expiresAt: daysFromNow(-9) }),
    ]);

    expect(alerts.map((a) => a.name)).toEqual(['Ancient', 'Recent']);
  });

  it('skips items with no expiry date at all', () => {
    expect(buildUrgentAlerts([makeItem({ name: 'Salt', expiresAt: null })])).toEqual([]);
  });

  it('caps the list', () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      makeItem({ name: `Item ${i}`, expiresAt: daysFromNow(-1) })
    );

    expect(buildUrgentAlerts(items, 3)).toHaveLength(3);
  });

  it('names an item that has no name', () => {
    expect(buildUrgentAlerts([makeItem({ name: '', expiresAt: daysFromNow(-1) })])[0].name).toBe(
      'Unnamed item'
    );
  });

  it('handles an empty or missing inventory', () => {
    expect(buildUrgentAlerts()).toEqual([]);
    expect(buildUrgentAlerts([])).toEqual([]);
  });
});

describe('UrgentAlerts', () => {
  it('reassures rather than alarms when nothing is at risk', () => {
    renderWithProviders(<UrgentAlerts items={[makeItem({ expiresAt: daysFromNow(60) })]} />);

    expect(screen.getByText('Nothing needs rescuing today.')).toBeInTheDocument();
    expect(screen.queryByText(/more waiting/)).not.toBeInTheDocument();
  });

  it('shows the same empty state for a kitchen with no items at all', () => {
    renderWithProviders(<UrgentAlerts items={[]} />);

    expect(screen.getByText('Nothing needs rescuing today.')).toBeInTheDocument();
  });

  it('says it is still checking while inventory loads', () => {
    renderWithProviders(<UrgentAlerts items={[]} loading />);

    expect(screen.getByText('Checking what needs using up…')).toBeInTheDocument();
  });

  it('lists each urgent item with a word for its state, not just a colour', () => {
    renderWithProviders(
      <UrgentAlerts
        items={[
          makeItem({ name: 'Old Yogurt', expiresAt: daysFromNow(-2) }),
          makeItem({ name: 'Fresh Fish', expiresAt: daysFromNow(1) }),
        ]}
      />
    );

    const list = screen.getByRole('list');
    expect(within(list).getByText('Old Yogurt')).toBeInTheDocument();
    expect(within(list).getByText('Expired')).toBeInTheDocument();
    expect(within(list).getByText('Fresh Fish')).toBeInTheDocument();
    expect(within(list).getByText('Use today')).toBeInTheDocument();
  });

  it('counts the overflow instead of hiding it', () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      makeItem({ name: `Item ${i}`, expiresAt: daysFromNow(-1) })
    );

    renderWithProviders(<UrgentAlerts items={items} max={5} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('and 2 more waiting in the inventory.')).toBeInTheDocument();
  });

  it('badges the total urgent count in the header', () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeItem({ name: `Item ${i}`, expiresAt: daysFromNow(-1) })
    );

    renderWithProviders(<UrgentAlerts items={items} max={2} />);

    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('offers a way through to the inventory', () => {
    renderWithProviders(<UrgentAlerts items={[makeItem({ expiresAt: daysFromNow(-1) })]} />);

    expect(screen.getByRole('link', { name: /open inventory/i })).toHaveAttribute(
      'href',
      '/inventory'
    );
  });
});
