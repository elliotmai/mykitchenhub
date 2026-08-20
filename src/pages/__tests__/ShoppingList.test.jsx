// The shopping list as its own screen: the same list the meal plan shows,
// grouped the way a shop is walked.

import React from 'react';

import ShoppingListPage from '../ShoppingList';
import {
  renderWithProviders,
  screen,
  waitFor,
  act,
  within,
  firestoreMock as fs,
  authMock,
} from '../../test-utils';
import {
  asDocs,
  makeItem,
  makeLocation,
  makeMealPlanEntry,
  dayKey,
} from '../../test-utils/factories';

const UID = 'test-uid';
const LOCATIONS = [makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' })];

const shoppingDoc = (name, overrides = {}) => ({
  id: `sl-${name}`,
  name,
  normalized: name.toLowerCase(),
  quantity: 1,
  unit: '',
  notes: '',
  status: 'pending',
  source: 'manual',
  createdAt: new Date().toISOString(),
  boughtAt: null,
  ...overrides,
});

const renderPage = async ({ manual = [], entries = [], items = [] } = {}) => {
  const view = renderWithProviders(<ShoppingListPage />, {
    route: '/shopping-list',
    user: authMock.__user({ uid: UID }),
  });

  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(`users/${UID}/inventory`, asDocs(items));
    fs.__emit(`users/${UID}/storageLocations`, asDocs(LOCATIONS));
    fs.__emit(`users/${UID}/mealPlanEntries`, asDocs(entries));
    fs.__emit(`users/${UID}/shoppingItems`, asDocs(manual));
  });
  return view;
};

describe('Shopping List page', () => {
  it('has its own heading, so the tab lands somewhere named', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Shopping List', level: 1 })).toBeInTheDocument();
  });

  it('shows what the cook typed in', async () => {
    await renderPage({ manual: [shoppingDoc('Batteries')] });
    expect(await screen.findByText('Batteries')).toBeInTheDocument();
  });

  // The point of the change: a list ordered like the shop, not like the recipes.
  it('groups items under the aisle they are found in', async () => {
    await renderPage({
      manual: [shoppingDoc('Milk'), shoppingDoc('Spinach'), shoppingDoc('Ice cream')],
    });

    await screen.findByText('Milk');
    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((h) => h.textContent)
      .filter((t) => ['Produce', 'Dairy & Eggs', 'Frozen'].includes(t));

    // Walk order, not the order they were typed.
    expect(headings).toEqual(['Produce', 'Dairy & Eggs', 'Frozen']);
  });

  it('puts each item under its own aisle', async () => {
    await renderPage({ manual: [shoppingDoc('Milk'), shoppingDoc('Spinach')] });
    await screen.findByText('Milk');

    const dairy = screen.getByRole('heading', { name: 'Dairy & Eggs' }).closest('section');
    expect(within(dairy).getByText('Milk')).toBeInTheDocument();

    const produce = screen.getByRole('heading', { name: 'Produce' }).closest('section');
    expect(within(produce).getByText('Spinach')).toBeInTheDocument();
  });

  it('files something it does not recognise under Other rather than dropping it', async () => {
    await renderPage({ manual: [shoppingDoc('Birthday candles')] });
    const other = (await screen.findByRole('heading', { name: 'Other' })).closest('section');
    expect(within(other).getByText('Birthday candles')).toBeInTheDocument();
  });

  it('explains itself when the list is completely empty', async () => {
    await renderPage();
    expect(
      await screen.findByText(/add meals to the week and everything they need shows up here/i)
    ).toBeInTheDocument();
  });

  it('says the kitchen has it all when the week needs only what is in stock', async () => {
    await renderPage({
      items: [makeItem({ id: 'i-eggs', name: 'eggs', quantity: 12 })],
      entries: [
        makeMealPlanEntry({
          id: 'e1',
          date: dayKey(1),
          recipeName: 'Omelette',
          usesIngredients: [{ name: 'eggs', normalized: 'eggs', quantity: 2, unit: '' }],
        }),
      ],
    });
    expect(await screen.findByText(/already has everything this week needs/i)).toBeInTheDocument();
  });

  // Both halves are one errand list, so a derived line files by aisle too.
  it('files the week’s own needs by aisle alongside the typed ones', async () => {
    await renderPage({
      entries: [
        makeMealPlanEntry({
          id: 'e1',
          date: dayKey(1),
          recipeName: 'Omelette',
          usesIngredients: [{ name: 'eggs', normalized: 'eggs', quantity: 6, unit: '' }],
        }),
      ],
      manual: [shoppingDoc('Spinach')],
    });

    const dairy = (await screen.findByRole('heading', { name: 'Dairy & Eggs' })).closest('section');
    // The row prints the name and its amount separately, so match list items
    // rather than any text node that happens to contain "eggs".
    const rows = within(dairy).getAllByRole('listitem');
    expect(rows.some((row) => /eggs/i.test(row.textContent))).toBe(true);
  });
});
