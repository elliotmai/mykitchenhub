// The fridge board: what it shows, what it leaves out, and what it says when
// it cannot keep the screen awake.

import React from 'react';

import Kiosk, { KIOSK_ITEM_LIMIT } from '../Kiosk';
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
  daysFromNow,
} from '../../test-utils/factories';

const UID = 'test-uid';

const LOCATIONS = [
  makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge', isDefault: true }),
];

const EXPIRING = [
  makeItem({ id: 'i1', name: 'Old Yogurt', expiresAt: daysFromNow(-1) }),
  makeItem({ id: 'i2', name: 'Spinach', expiresAt: daysFromNow(1) }),
];

const renderBoard = async ({ items = EXPIRING, entries = [] } = {}) => {
  const view = renderWithProviders(<Kiosk />, {
    route: '/kiosk',
    user: authMock.__user({ uid: UID }),
  });

  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(`users/${UID}/inventory`, asDocs(items));
    fs.__emit(`users/${UID}/storageLocations`, asDocs(LOCATIONS));
    fs.__emit(`users/${UID}/mealPlanEntries`, asDocs(entries));
  });

  return view;
};

describe('Kiosk board', () => {
  beforeEach(() => {
    navigator.wakeLock = {
      request: jest.fn().mockResolvedValue({ release: jest.fn(), addEventListener: jest.fn() }),
    };
  });

  afterEach(() => delete navigator.wakeLock);

  it('lists what needs eating, worst first', async () => {
    await renderBoard();

    const names = screen.getAllByText(/Old Yogurt|Spinach/).map((el) => el.textContent);
    expect(names[0]).toBe('Old Yogurt');
    expect(screen.getByText(/Expired 1d ago/)).toBeInTheDocument();
  });

  it('says so plainly when nothing is about to go off', async () => {
    await renderBoard({
      items: [makeItem({ id: 'ok', name: 'Rice', expiresAt: daysFromNow(300) })],
    });
    expect(await screen.findByText(/Nothing about to go off/i)).toBeInTheDocument();
  });

  // A board you have to scroll is not a board. Past the limit it stops listing
  // and points at the page that shows the rest.
  it('stops at the limit rather than growing off the screen', async () => {
    const many = Array.from({ length: KIOSK_ITEM_LIMIT + 4 }, (_, i) =>
      makeItem({ id: `x${i}`, name: `Item ${i}`, expiresAt: daysFromNow(1) })
    );
    await renderBoard({ items: many });

    expect(screen.getByText(`Item 0`)).toBeInTheDocument();
    expect(screen.queryByText(`Item ${KIOSK_ITEM_LIMIT}`)).not.toBeInTheDocument();
    expect(screen.getByText(/and 4 more/i)).toBeInTheDocument();
  });

  it('counts the whole kitchen, not just the expiring corner of it', async () => {
    await renderBoard({
      items: [...EXPIRING, makeItem({ id: 'i3', name: 'Rice', expiresAt: daysFromNow(300) })],
    });
    expect(screen.getByText(/3 items in the kitchen/i)).toBeInTheDocument();
  });

  it('offers a way into the full app', async () => {
    await renderBoard();
    expect(screen.getByRole('link', { name: /open the full app/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });

  it('says nothing about the screen while it is holding it awake', async () => {
    await renderBoard();
    await waitFor(() => expect(navigator.wakeLock.request).toHaveBeenCalled());
    expect(screen.queryByText(/display timeout/i)).not.toBeInTheDocument();
  });

  // The board going dark with no explanation looks like a broken tablet.
  it('tells the cook to set the display timeout when it cannot hold the screen', async () => {
    delete navigator.wakeLock;
    await renderBoard();
    expect(await screen.findByText(/display timeout to Never/i)).toBeInTheDocument();
  });

  describe('the week', () => {
    it('shows all seven days, Monday to Sunday, whatever day it is today', async () => {
      await renderBoard();

      const days = screen
        .getAllByRole('listitem')
        .filter((li) => li.className.includes('kiosk__day'));
      expect(days).toHaveLength(7);
      expect(days.map((li) => li.querySelector('.kiosk__day-name').textContent)).toEqual([
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
        'Sun',
      ]);
    });

    it('numbers each day with its date, not just its name', async () => {
      await renderBoard();

      const numbers = screen
        .getAllByRole('listitem')
        .filter((li) => li.className.includes('kiosk__day'))
        .map((li) => Number(li.querySelector('.kiosk__day-number').textContent));

      expect(numbers).toHaveLength(7);
      numbers.forEach((n) => {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(31);
      });
    });

    it('marks today, so a glance lands on the right row', async () => {
      await renderBoard();
      const today = document.querySelectorAll('.kiosk__day--today');
      expect(today).toHaveLength(1);
      expect(today[0]).toHaveAttribute('aria-current', 'date');
    });

    it('puts a planned meal against its day', async () => {
      const today = dayKey(0);
      await renderBoard({
        entries: [makeMealPlanEntry({ id: 'e1', date: today, recipeName: 'Sheet Pan Salmon' })],
      });
      expect(await screen.findByText('Sheet Pan Salmon')).toBeInTheDocument();
    });

    it('leaves an empty night visibly empty rather than hiding it', async () => {
      await renderBoard({ entries: [] });
      const dashes = Array.from(document.querySelectorAll('.kiosk__day-meal')).filter(
        (el) => el.textContent === '—'
      );
      expect(dashes).toHaveLength(7);
    });
  });

  // The week is the reason someone looks at the fridge, so it leads and takes
  // the wider column.
  it('puts the week before the list of what is going off', async () => {
    await renderBoard();
    const panels = Array.from(document.querySelectorAll('.kiosk__panel'));
    expect(panels.map((p) => p.className)).toEqual([
      expect.stringContaining('kiosk__panel--week'),
      expect.stringContaining('kiosk__panel--eat'),
      expect.stringContaining('kiosk__panel--shopping'),
    ]);
  });

  // Reserved space for a feature the owner is building. It must render, and it
  // must not pretend to hold anything.
  it('reserves a corner for the shopping list without inventing one', async () => {
    await renderBoard();
    const panel = screen.getByTestId('kiosk-shopping');
    expect(within(panel).getByRole('heading', { name: 'Shopping list' })).toBeInTheDocument();
    expect(within(panel).getByText('Coming soon')).toBeInTheDocument();
    expect(within(panel).queryAllByRole('listitem')).toHaveLength(0);
  });
});
