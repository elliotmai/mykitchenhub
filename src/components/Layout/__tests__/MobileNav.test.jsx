// The bottom tab bar a phone gets instead of two taps through the drawer.

import React from 'react';

import MobileNav, { MOBILE_NAV_ITEMS } from '../MobileNav';
import { renderWithProviders, screen, userEvent, within } from '../../../test-utils';

const renderNav = (props = {}, { route = '/dashboard' } = {}) => {
  const view = renderWithProviders(<MobileNav onOpenMore={() => {}} {...props} />, { route });
  return { ...view, user: userEvent.setup() };
};

const bar = () => screen.getByRole('navigation', { name: 'Primary' });

describe('MobileNav', () => {
  it('offers a one-tap link to each of the pages a cook moves between', () => {
    renderNav();

    MOBILE_NAV_ITEMS.forEach(({ label, path }) => {
      expect(within(bar()).getByRole('link', { name: label })).toHaveAttribute('href', path);
    });
  });

  it('leaves room for "More", so the rest of the app is still reachable', async () => {
    const onOpenMore = jest.fn();
    const { user } = renderNav({ onOpenMore });

    await user.click(within(bar()).getByRole('button', { name: /more/i }));

    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });

  it('marks the page you are on', () => {
    renderNav({}, { route: '/recipes' });

    expect(within(bar()).getByRole('link', { name: 'Recipes' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(within(bar()).getByRole('link', { name: 'Inventory' })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('puts the alert count on the Alerts tab, where the expiring food is', () => {
    renderNav({ alertCount: 3 });

    const alerts = within(bar()).getByRole('link', { name: 'Alerts' });
    expect(within(alerts).getByText('3')).toBeInTheDocument();
  });

  it('caps a large count so a wide badge cannot push the row off-screen', () => {
    renderNav({ alertCount: 42 });

    expect(within(bar()).getByText('9+')).toBeInTheDocument();
  });

  it('shows no badge when nothing is expiring', () => {
    renderNav({ alertCount: 0 });

    const alerts = within(bar()).getByRole('link', { name: 'Alerts' });
    expect(within(alerts).queryByText(/\d/)).not.toBeInTheDocument();
  });

  it('stays at five tabs — a sixth cannot hold 44px on a 360px screen', () => {
    // The bar is the one place where the touch-target floor is a layout
    // constraint rather than a style, so it is asserted rather than commented.
    expect(MOBILE_NAV_ITEMS.length).toBeLessThanOrEqual(4);
  });
});
