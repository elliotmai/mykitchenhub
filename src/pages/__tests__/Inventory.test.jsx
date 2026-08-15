// The inventory page end to end from the frontend's side: real hooks, real
// components, mocked Firestore.
//
// The focus here is the app-shortcut entry point. An installed PWA offers "Add
// Item" from a long-press on the home-screen icon, and that shortcut opens
// /inventory?action=add — but nothing on the page had ever read the parameter,
// so the shortcut dropped the cook on the inventory list with no form open and
// no clue that it was meant to do anything (roadmap 9.4).

import React from 'react';

import Inventory from '../Inventory';
import {
  renderWithProviders,
  screen,
  waitFor,
  act,
  userEvent,
  firestoreMock as fs,
} from '../../test-utils';
import { asDocs, makeItem, makeLocation } from '../../test-utils/factories';

const UID = 'test-uid';

const LOCATIONS = [
  makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge', isDefault: true }),
  makeLocation({ id: 'loc-pantry', label: 'Pantry', type: 'pantry', isDefault: true }),
];

const ITEMS = [makeItem({ id: 'item-milk', name: 'Milk', locationId: 'loc-fridge' })];

/** Render the page signed in, with the kitchen already delivered. */
const renderPage = async ({ route = '/inventory', items = ITEMS } = {}) => {
  const view = renderWithProviders(<Inventory />, { route });

  await waitFor(() =>
    expect(fs.__listenerCount(`users/${UID}/storageLocations`)).toBeGreaterThan(0)
  );

  await act(async () => {
    fs.__emit(`users/${UID}/storageLocations`, asDocs(LOCATIONS));
    fs.__emit(`users/${UID}/inventory`, asDocs(items));
  });

  return { ...view, user: userEvent.setup() };
};

describe('Inventory page', () => {
  it('lists what is in the kitchen', async () => {
    await renderPage();
    expect(screen.getByText('Milk')).toBeInTheDocument();
  });

  it('does not open the add form on a plain visit', async () => {
    await renderPage();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Inventory page — the "Add Item" app shortcut', () => {
  it('opens the add form when launched with ?action=add', async () => {
    await renderPage({ route: '/inventory?action=add' });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
  });

  it('clears the parameter, so closing the form does not reopen it', async () => {
    const { user } = await renderPage({ route: '/inventory?action=add' });
    await screen.findByRole('dialog');

    // The URL must not still say `action=add` — otherwise a re-render, or the
    // back button, drops the cook straight back into the form they just closed.
    expect(window.location.search).not.toContain('action=add');

    await user.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ignores an action it does not recognise rather than guessing', async () => {
    await renderPage({ route: '/inventory?action=scan' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Inventory page — an empty kitchen', () => {
  it('says the kitchen is empty instead of showing a bare page', async () => {
    await renderPage({ items: [] });

    expect(await screen.findByText(/your inventory is empty/i)).toBeInTheDocument();
  });
});
