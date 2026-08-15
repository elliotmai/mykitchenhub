// The waste alerts page end to end from the frontend's side: real hooks, real
// components, mocked Firestore. This is the page a cook opens when the daily
// alert tells them something needs eating.

import React from 'react';

import WasteAlerts from '../WasteAlerts';
import {
  renderWithProviders,
  screen,
  waitFor,
  act,
  within,
  userEvent,
  firestoreMock as fs,
  authMock,
} from '../../test-utils';
import {
  asDocs,
  makeItem,
  makeLocation,
  makeNotification,
  makeRecipe,
  daysFromNow,
} from '../../test-utils/factories';

const UID = 'test-uid';

const LOCATIONS = [
  makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge', isDefault: true }),
  makeLocation({ id: 'loc-freezer', label: 'Freezer', type: 'freezer', isDefault: true }),
];

const ITEMS = [
  makeItem({
    id: 'item-yogurt',
    name: 'Old Yogurt',
    locationType: 'fridge',
    expiresAt: daysFromNow(-2),
  }),
  makeItem({
    id: 'item-spinach',
    name: 'Spinach',
    quantity: 2,
    locationType: 'fridge',
    expiresAt: daysFromNow(1),
  }),
  makeItem({ id: 'item-rice', name: 'Rice', locationType: 'pantry', expiresAt: daysFromNow(300) }),
];

const RECIPES = [
  makeRecipe({
    id: 'recipe-1',
    name: 'Creamed Spinach',
    ingredients: [{ name: 'spinach', normalized: 'spinach', quantity: 1, unit: 'bag' }],
  }),
];

/** Render the page signed in with the given kitchen already delivered. */
const renderPage = async ({
  items = ITEMS,
  locations = LOCATIONS,
  recipes = RECIPES,
  notifications = [],
} = {}) => {
  fs.getDocs.mockResolvedValue(fs.__querySnapshot(asDocs(recipes)));

  const view = renderWithProviders(<WasteAlerts />, {
    route: '/waste-alerts',
    user: authMock.__user({ uid: UID }),
  });

  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(`users/${UID}/inventory`, asDocs(items));
    fs.__emit(`users/${UID}/storageLocations`, asDocs(locations));
    fs.__emit(`users/${UID}/notifications`, asDocs(notifications));
  });

  return view;
};

describe('WasteAlerts page', () => {
  it('leads with how many things need attention', async () => {
    await renderPage();

    expect(await screen.findByRole('heading', { name: /Waste Alerts/ })).toBeInTheDocument();
    expect(screen.getByText('2 items to use, freeze or cook soon.')).toBeInTheDocument();
  });

  it('lists the at-risk food and leaves the rest of the kitchen out of it', async () => {
    await renderPage();

    const rows = await screen.findAllByTestId('expiring-item');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Old Yogurt'),
      expect.stringContaining('Spinach'),
    ]);
    expect(screen.queryByText('Rice')).not.toBeInTheDocument();
  });

  it('counts each urgency band in the summary', async () => {
    await renderPage();

    expect(screen.getByTestId('summary-expired')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-critical')).toHaveTextContent('1');
  });

  it('says nothing needs rescuing when the kitchen is in good shape', async () => {
    await renderPage({ items: [ITEMS[2]] });

    expect(await screen.findByText('Nothing needs rescuing today.')).toBeInTheDocument();
    expect(screen.getByTestId('nothing-at-risk')).toHaveTextContent('Nothing is going to waste');
  });

  it('says the good news once, not four times over', async () => {
    // The page used to render zero-count tiles beside three separate "nothing
    // here" panels, which reads like a page that failed to load.
    await renderPage({ items: [ITEMS[2]] });

    await screen.findByTestId('nothing-at-risk');
    expect(screen.queryByTestId('summary-expired')).not.toBeInTheDocument();
    expect(screen.queryByTestId('freezer-suggestions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recipe-suggestions')).not.toBeInTheDocument();
  });

  it('points an empty kitchen at the inventory rather than congratulating it', async () => {
    await renderPage({ items: [] });

    const panel = await screen.findByTestId('nothing-at-risk');
    expect(panel).toHaveTextContent('Nothing to keep an eye on yet');
    expect(
      screen.getByRole('link', { name: /Add something to your inventory/ })
    ).toBeInTheDocument();
  });

  it('says so when the recipe library will not load', async () => {
    // The hook already tracked this error and the page never read it, so a
    // failed load rendered "No recipes use what is expiring right now" — a
    // confident wrong answer instead of a problem.
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.getDocs.mockRejectedValue(new Error('offline'));

    renderWithProviders(<WasteAlerts />, {
      route: '/waste-alerts',
      user: authMock.__user({ uid: UID }),
    });

    await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
    await act(async () => {
      fs.__emit(`users/${UID}/inventory`, asDocs(ITEMS));
      fs.__emit(`users/${UID}/storageLocations`, asDocs(LOCATIONS));
    });

    expect(await screen.findByText(/Failed to load recipe suggestions/)).toBeInTheDocument();
  });

  it('says so when past alerts will not load', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.getDocs.mockResolvedValue(fs.__querySnapshot(asDocs(RECIPES)));

    renderWithProviders(<WasteAlerts />, {
      route: '/waste-alerts',
      user: authMock.__user({ uid: UID }),
    });

    await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
    await act(async () => {
      fs.__emit(`users/${UID}/inventory`, asDocs(ITEMS));
      fs.__emit(`users/${UID}/storageLocations`, asDocs(LOCATIONS));
      fs.__emitError(`users/${UID}/notifications`, new Error('permission denied'));
    });

    expect(await screen.findByText(/Failed to load notifications/)).toBeInTheDocument();
    // The at-risk list is independent of that failure and must survive it.
    expect(screen.getByTestId('freezer-suggestions')).toBeInTheDocument();
  });

  it('offers to freeze what the freezer would save', async () => {
    await renderPage();

    const panel = await screen.findByTestId('freezer-suggestions');
    expect(panel).toHaveTextContent('Spinach');
    expect(panel).toHaveTextContent('if you freeze it');
  });

  it('freezing an item writes the move and a much later expiry', async () => {
    await renderPage();

    const panel = await screen.findByTestId('freezer-suggestions');
    const card = (await screen.findAllByTestId('freezer-suggestion')).find((el) =>
      el.textContent.includes('Spinach')
    );
    expect(panel).toContainElement(card);

    await act(async () => {
      await userEvent.click(within(card).getByRole('button', { name: 'Freeze All' }));
    });

    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`users/${UID}/inventory/item-spinach`);
    expect(patch.locationType).toBe('freezer');
    // Spinach keeps a year frozen versus a day in the fridge.
    const days = Math.round((patch.expiresAt - new Date()) / 86400000);
    expect(days).toBe(365);
  });

  it('suggests a recipe that uses the expiring food', async () => {
    await renderPage();

    const panel = await screen.findByTestId('recipe-suggestions');
    await waitFor(() => expect(panel).toHaveTextContent('Creamed Spinach'));
    expect(panel).toHaveTextContent('1 expiring item');
  });

  it('adding a suggestion to the meal plan writes a meal plan document', async () => {
    await renderPage();

    const button = await screen.findByRole('button', { name: /Add to Meal Plan/ });
    await act(async () => {
      await userEvent.click(button);
    });

    const [ref, payload] = fs.addDoc.mock.calls[0];
    // Phase 7 owns this collection; Phase 6 writes into it in their shape.
    expect(fs.pathOf(ref)).toBe(`users/${UID}/mealPlanEntries`);
    expect(payload).toMatchObject({
      recipeId: 'recipe-1',
      recipeName: 'Creamed Spinach',
      source: 'waste-prevention',
      status: 'planned',
    });
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("shows the morning's in-app alert", async () => {
    await renderPage({
      notifications: [makeNotification({ id: 'n-1', title: '2 items to use up soon' })],
    });

    expect(await screen.findByTestId('waste-alert-notifications')).toHaveTextContent(
      '2 items to use up soon'
    );
  });

  it('hides the alert panel entirely when there is nothing to say', async () => {
    await renderPage({ notifications: [] });

    expect(screen.queryByTestId('waste-alert-notifications')).not.toBeInTheDocument();
  });

  it('surfaces an inventory read failure instead of a blank page', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await renderPage();

    await act(async () => {
      fs.__emitError(`users/${UID}/inventory`, new Error('permission-denied'));
    });

    expect(await screen.findByText('Failed to load inventory')).toBeInTheDocument();
  });
});
