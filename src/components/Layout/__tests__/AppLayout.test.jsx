// The shell every signed-in page renders inside.
//
// The alert count is the thing worth testing here. App.jsx rendered
// <AppLayout alertCount={0} /> — a literal zero that had been there since the
// layout was written, so the bell badge, the sidebar banner and the bottom-bar
// badge could never appear however much food was going off (roadmap 9.4).
// The layout now works it out itself, from the same hook the waste alerts page
// uses, so the three of them cannot disagree.

import React from 'react';

import AppLayout from '../AppLayout';
import {
  renderWithProviders,
  screen,
  waitFor,
  act,
  within,
  firestoreMock as fs,
} from '../../../test-utils';
import { asDocs, makeItem, makeLocation, daysFromNow } from '../../../test-utils/factories';

const UID = 'test-uid';

const LOCATIONS = [makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' })];

/**
 * Renders the shell with a kitchen in it.
 *
 * @param {Array} items - inventory documents to deliver to the listener
 */
const renderLayout = async ({ items = [] } = {}) => {
  const view = renderWithProviders(<AppLayout />, { route: '/dashboard' });

  await waitFor(() => expect(fs.__listenerCount(`users/${UID}/inventory`)).toBeGreaterThan(0));

  await act(async () => {
    fs.__emit(`users/${UID}/storageLocations`, asDocs(LOCATIONS));
    fs.__emit(`users/${UID}/inventory`, asDocs(items));
  });

  return view;
};

/** Two things going off within the alert window, and one that is fine. */
const KITCHEN_WITH_TWO_URGENT = [
  makeItem({ id: 'a', name: 'Old Yogurt', locationType: 'fridge', expiresAt: daysFromNow(-1) }),
  makeItem({ id: 'b', name: 'Salmon', locationType: 'fridge', expiresAt: daysFromNow(1) }),
  makeItem({ id: 'c', name: 'Rice', locationType: 'pantry', expiresAt: daysFromNow(300) }),
];

describe('AppLayout alert count', () => {
  it('badges the bell with how much food is about to go off', async () => {
    await renderLayout({ items: KITCHEN_WITH_TWO_URGENT });

    const bell = screen.getByRole('button', { name: 'View notifications' });
    expect(await within(bell).findByText('2')).toBeInTheDocument();
  });

  it('tells the sidebar the same number', async () => {
    await renderLayout({ items: KITCHEN_WITH_TWO_URGENT });

    expect(await screen.findByText(/2 items expiring soon/i)).toBeInTheDocument();
  });

  it('badges the bottom bar too, so a phone sees it without opening anything', async () => {
    await renderLayout({ items: KITCHEN_WITH_TWO_URGENT });

    const bar = screen.getByRole('navigation', { name: 'Primary' });
    const alerts = within(bar).getByRole('link', { name: 'Alerts' });
    expect(await within(alerts).findByText('2')).toBeInTheDocument();
  });

  it('shows no badge at all when nothing is going off', async () => {
    await renderLayout({
      items: [makeItem({ id: 'c', name: 'Rice', expiresAt: daysFromNow(300) })],
    });

    const bell = screen.getByRole('button', { name: 'View notifications' });
    expect(within(bell).queryByText(/\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/expiring soon/i)).not.toBeInTheDocument();
  });

  it('says "item", not "items", for a single one', async () => {
    await renderLayout({
      items: [makeItem({ id: 'a', name: 'Old Yogurt', expiresAt: daysFromNow(-1) })],
    });

    expect(await screen.findByText(/1 item expiring soon/i)).toBeInTheDocument();
  });
});
