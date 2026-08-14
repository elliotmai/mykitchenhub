// The dashboard reads four collections, three of which belong to roadmap phases
// still being built. These cover the wiring and, more importantly, that an
// absent collection produces an empty state rather than a broken page.

import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { renderWithProviders, screen, firestoreMock as fs } from '../../test-utils';
import {
  asDocs,
  makeItem,
  makeMealPlan,
  makeUserProfile,
  daysFromNow,
} from '../../test-utils/factories';
import Dashboard, { countExpiringSoon } from '../Dashboard';

const UID = 'test-uid';
const INVENTORY_PATH = `users/${UID}/inventory`;
const PLANS_PATH = `users/${UID}/mealPlans`;

/**
 * Render the dashboard signed in, then deliver the snapshots its three
 * listeners are waiting on.
 */
const renderDashboard = async ({ items = [], plans = [], recipeCount = 0 } = {}) => {
  fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: recipeCount }) });

  const view = renderWithProviders(<Dashboard />, {
    route: '/dashboard',
    userProfile: makeUserProfile({ displayName: 'Sam' }),
  });

  await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBe(1));
  await act(async () => {
    fs.__emit(INVENTORY_PATH, asDocs(items));
    fs.__emit(PLANS_PATH, asDocs(plans));
  });

  return view;
};

describe('countExpiringSoon', () => {
  it('counts everything inside the five-day window, expired included', () => {
    expect(
      countExpiringSoon([
        makeItem({ expiresAt: daysFromNow(-2) }),
        makeItem({ expiresAt: daysFromNow(1) }),
        makeItem({ expiresAt: daysFromNow(4) }),
        makeItem({ expiresAt: daysFromNow(30) }),
      ])
    ).toBe(3);
  });

  it('is zero for an empty kitchen', () => {
    expect(countExpiringSoon([])).toBe(0);
    expect(countExpiringSoon()).toBe(0);
  });
});

describe('Dashboard', () => {
  it('greets the cook by name', async () => {
    await renderDashboard();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /good (morning|afternoon|evening), Sam!/i
    );
  });

  it('fills in every stat from real data', async () => {
    await renderDashboard({
      items: [
        makeItem({ name: 'Old Yogurt', expiresAt: daysFromNow(-2) }),
        makeItem({ name: 'Rice', expiresAt: daysFromNow(200) }),
      ],
      plans: [makeMealPlan()],
      recipeCount: 42,
    });

    const values = screen.getAllByTestId('stat-card-value').map((el) => el.textContent);
    // Total items, expiring soon, recipes, meals planned.
    expect(values).toEqual(['2', '1', '42', '2']);
  });

  it('shows honest zeroes, not dashes, for a brand new empty kitchen', async () => {
    await renderDashboard();

    expect(screen.getAllByTestId('stat-card-value').map((el) => el.textContent)).toEqual([
      '0',
      '0',
      '0',
      '0',
    ]);
  });

  it('renders every section when nothing exists yet', async () => {
    await renderDashboard();

    expect(screen.getByText('Nothing needs rescuing today.')).toBeInTheDocument();
    expect(screen.getByText('No meals planned for this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add an item' })).toBeInTheDocument();
  });

  it('lists what needs cooking first', async () => {
    await renderDashboard({
      items: [
        makeItem({ name: 'Old Yogurt', expiresAt: daysFromNow(-2) }),
        makeItem({ name: 'Rice', expiresAt: daysFromNow(200) }),
      ],
    });

    expect(screen.getByText('Old Yogurt')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it("previews this week's dinners", async () => {
    await renderDashboard({ plans: [makeMealPlan()] });

    expect(screen.getByText('Sheet Pan Salmon')).toBeInTheDocument();
    expect(screen.getByText('Chicken Stir Fry')).toBeInTheDocument();
  });

  it('does not break when the meal plan collection cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(<Dashboard />, { route: '/dashboard' });
    await waitFor(() => expect(fs.__listenerCount(PLANS_PATH)).toBe(1));

    await act(async () => {
      fs.__emit(INVENTORY_PATH, []);
      fs.__emitError(PLANS_PATH, new Error('permission-denied'));
    });

    expect(screen.getByText('No meals planned for this week yet.')).toBeInTheDocument();
    expect(screen.getAllByTestId('stat-card-value')[3]).toHaveTextContent('0');
  });

  it('warns when inventory itself fails, since every stat depends on it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(<Dashboard />, { route: '/dashboard' });
    await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBe(1));

    await act(async () => {
      fs.__emitError(INVENTORY_PATH, new Error('permission-denied'));
    });

    expect(
      screen.getByText(/failed to load inventory\. the numbers below may be out of date/i)
    ).toBeInTheDocument();
  });

  it('offers a quick action for each of the four main pages', async () => {
    await renderDashboard();

    ['/inventory', '/meal-plan', '/recipes', '/analytics'].forEach((route) => {
      expect(document.querySelector(`a[href="${route}"]`)).toBeInTheDocument();
    });
  });
});
