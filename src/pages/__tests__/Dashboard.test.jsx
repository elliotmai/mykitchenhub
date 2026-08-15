// The dashboard reads four collections, three of which belong to roadmap phases
// still being built. These cover the wiring and, more importantly, that an
// absent collection produces an empty state rather than a broken page.

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { renderWithProviders, screen, firestoreMock as fs, authMock } from '../../test-utils';
import { AuthProvider } from '../../hooks/useAuth';
import useWasteAlerts from '../../hooks/useWasteAlerts';
import {
  asDocs,
  makeItem,
  makeMealPlanEntry,
  makeUserProfile,
  daysFromNow,
} from '../../test-utils/factories';
import Dashboard, { countExpiringSoon, weekRangeLabel } from '../Dashboard';

const UID = 'test-uid';
const INVENTORY_PATH = `users/${UID}/inventory`;
const ENTRIES_PATH = `users/${UID}/mealPlanEntries`;

/**
 * Render the dashboard signed in, then deliver the snapshots its three
 * listeners are waiting on.
 */
const renderDashboard = async ({ items = [], entries = [], recipeCount = 0 } = {}) => {
  fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: recipeCount }) });

  const view = renderWithProviders(<Dashboard />, {
    route: '/dashboard',
    userProfile: makeUserProfile({ displayName: 'Sam' }),
  });

  await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBeGreaterThan(0));
  await act(async () => {
    fs.__emit(INVENTORY_PATH, asDocs(items));
    fs.__emit(ENTRIES_PATH, asDocs(entries));
  });

  return view;
};

describe('weekRangeLabel', () => {
  it('spans Monday to Sunday of the week it is given', () => {
    expect(weekRangeLabel('2026-08-10')).toBe('Aug 10 – Aug 16');
  });

  it('is empty rather than "Invalid Date" without a week', () => {
    expect(weekRangeLabel('')).toBe('');
    expect(weekRangeLabel(undefined)).toBe('');
  });
});

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

  it('ignores an item with no expiry date at all', () => {
    expect(
      countExpiringSoon([makeItem({ expiresAt: null }), makeItem({ expiresAt: undefined })])
    ).toBe(0);
  });

  it('counts the day-five boundary in and the day-six boundary out', () => {
    expect(countExpiringSoon([makeItem({ expiresAt: daysFromNow(5) })])).toBe(1);
    expect(countExpiringSoon([makeItem({ expiresAt: daysFromNow(6) })])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Agreement with the Waste Alerts page
//
// Two screens showing "how much food is about to go off" have to show the same
// number, or one of them is lying. The dashboard derives its tile from the
// expiration *status*; the waste-alerts page counts a day window. They are
// meant to be the same set, and nothing enforces that but this.
// ---------------------------------------------------------------------------

describe('the Expiring Soon tile and the Waste Alerts page', () => {
  /** The waste-alerts hook, signed in, with its two listeners attached. */
  const renderWasteAlerts = async () => {
    authMock.__setUser(authMock.__user({ uid: UID }));
    fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

    const view = renderHook(() => useWasteAlerts(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });

    await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBeGreaterThan(0));
    return view;
  };

  const spread = () => [
    makeItem({ name: 'Long gone', expiresAt: daysFromNow(-9) }),
    makeItem({ name: 'Expired', expiresAt: daysFromNow(-1) }),
    makeItem({ name: 'Today', expiresAt: daysFromNow(0) }),
    makeItem({ name: 'Critical', expiresAt: daysFromNow(2) }),
    makeItem({ name: 'Warning', expiresAt: daysFromNow(3) }),
    makeItem({ name: 'Edge in', expiresAt: daysFromNow(5) }),
    makeItem({ name: 'Edge out', expiresAt: daysFromNow(6) }),
    makeItem({ name: 'Fresh', expiresAt: daysFromNow(90) }),
    makeItem({ name: 'No date', expiresAt: null }),
  ];

  it('count the same items, boundary for boundary', async () => {
    const items = spread();
    const { result } = await renderWasteAlerts();

    await act(async () => {
      fs.__emit(INVENTORY_PATH, asDocs(items));
      fs.__emit(`users/${UID}/storageLocations`, asDocs([]));
    });

    expect(countExpiringSoon(items)).toBe(result.current.counts.total);
    expect(countExpiringSoon(items)).toBe(6);
  });

  it('agree that an empty kitchen has nothing at risk', async () => {
    const { result } = await renderWasteAlerts();

    await act(async () => {
      fs.__emit(INVENTORY_PATH, []);
      fs.__emit(`users/${UID}/storageLocations`, asDocs([]));
    });

    expect(countExpiringSoon([])).toBe(result.current.counts.total);
    expect(result.current.counts.total).toBe(0);
  });
});

describe('Dashboard', () => {
  it('greets the cook by name', async () => {
    await renderDashboard();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /good (morning|afternoon|evening), Sam!/i
    );
  });

  it.each([
    [8, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [16, 'Good afternoon'],
    [17, 'Good evening'],
    [23, 'Good evening'],
  ])('greets at %i:00 with "%s"', async (hour, greeting) => {
    // The boundaries are the whole point: at noon and at 5pm the greeting
    // changes, and only one of the three branches runs on any given test run.
    // Restored in a finally — this suite does not reset mocks between tests, so
    // a failure here would otherwise freeze the clock for everything after it.
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(hour);

    try {
      await renderDashboard();

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(greeting);
    } finally {
      Date.prototype.getHours.mockRestore();
    }
  });

  it('greets a cook whose profile has no name yet', async () => {
    fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 0 }) });
    renderWithProviders(<Dashboard />, { route: '/dashboard', userProfile: null });

    await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBeGreaterThan(0));
    await act(async () => {
      fs.__emit(INVENTORY_PATH, []);
    });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/, there!/);
  });

  it('fills in every stat from real data', async () => {
    await renderDashboard({
      items: [
        makeItem({ name: 'Old Yogurt', expiresAt: daysFromNow(-2) }),
        makeItem({ name: 'Rice', expiresAt: daysFromNow(200) }),
      ],
      entries: [makeMealPlanEntry(), makeMealPlanEntry({ recipeName: 'Chicken Stir Fry' })],
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
    await renderDashboard({
      entries: [makeMealPlanEntry({ recipeName: 'Sheet Pan Salmon' })],
    });

    expect(screen.getByText('Sheet Pan Salmon')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('does not break when the meal plan collection cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(<Dashboard />, { route: '/dashboard' });
    await waitFor(() => expect(fs.__listenerCount(ENTRIES_PATH)).toBeGreaterThan(0));

    await act(async () => {
      fs.__emit(INVENTORY_PATH, []);
      fs.__emitError(ENTRIES_PATH, new Error('permission-denied'));
    });

    expect(screen.getByText('No meals planned for this week yet.')).toBeInTheDocument();
    // A dash, not a zero: "no meals planned" and "we could not read your meal
    // plan" are different things to tell someone deciding what to cook.
    expect(screen.getAllByTestId('stat-card-value')[3]).toHaveTextContent('—');
    expect(screen.getByText(/failed to load your meal plan/i)).toBeInTheDocument();
  });

  it('dashes the recipe tile when the library cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.getCountFromServer.mockRejectedValue(new Error('unsupported'));
    fs.getDocs.mockRejectedValue(new Error('permission-denied'));

    renderWithProviders(<Dashboard />, { route: '/dashboard' });
    await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBeGreaterThan(0));
    await act(async () => {
      fs.__emit(INVENTORY_PATH, []);
      fs.__emit(ENTRIES_PATH, []);
    });

    await waitFor(() => expect(screen.getAllByTestId('stat-card-value')[2]).toHaveTextContent('—'));
    expect(screen.getByText(/failed to load recipes/i)).toBeInTheDocument();
    // The tiles that did load still show their numbers.
    expect(screen.getAllByTestId('stat-card-value')[0]).toHaveTextContent('0');
  });

  it('names every source that failed, not just the first', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.getCountFromServer.mockRejectedValue(new Error('unsupported'));
    fs.getDocs.mockRejectedValue(new Error('permission-denied'));

    renderWithProviders(<Dashboard />, { route: '/dashboard' });
    await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBeGreaterThan(0));
    await act(async () => {
      fs.__emitError(INVENTORY_PATH, new Error('permission-denied'));
      fs.__emitError(ENTRIES_PATH, new Error('permission-denied'));
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          /failed to load inventory\. failed to load recipes\. failed to load your meal plan\./i
        )
      ).toBeInTheDocument()
    );
    expect(screen.getAllByTestId('stat-card-value').map((el) => el.textContent)).toEqual([
      '—',
      '—',
      '—',
      '—',
    ]);
  });

  it('warns when inventory itself fails, since every stat depends on it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    renderWithProviders(<Dashboard />, { route: '/dashboard' });
    await waitFor(() => expect(fs.__listenerCount(INVENTORY_PATH)).toBeGreaterThan(0));

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
