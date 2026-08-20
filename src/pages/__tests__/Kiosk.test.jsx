// The fridge board: what it shows, what it leaves out, and what it says when
// it cannot keep the screen awake.

import React from 'react';

import Kiosk, { KIOSK_ITEM_LIMIT, KIOSK_SHOPPING_LIMIT } from '../Kiosk';
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
  makeShoppingItem,
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

const renderBoard = async ({ items = EXPIRING, entries = [], shopping = [] } = {}) => {
  const view = renderWithProviders(<Kiosk />, {
    route: '/kiosk',
    user: authMock.__user({ uid: UID }),
  });

  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(`users/${UID}/inventory`, asDocs(items));
    fs.__emit(`users/${UID}/storageLocations`, asDocs(LOCATIONS));
    fs.__emit(`users/${UID}/mealPlanEntries`, asDocs(entries));
    fs.__emit(`users/${UID}/shoppingItems`, asDocs(shopping));
  });

  return view;
};

/** A meal that puts `name` on the derived half of the shopping list. */
const mealNeeding = (name, { quantity = 2, unit = 'g', id = 'meal-1' } = {}) =>
  makeMealPlanEntry({
    id,
    date: dayKey(0),
    recipeName: `Dinner with ${name}`,
    usesIngredients: [{ name, normalized: name.toLowerCase(), quantity, unit }],
  });

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

  // ------------------------------------------------------------------------
  // The shopping list
  //
  // One question, answered from across the kitchen on the way out of the door:
  // what do I need to buy. Both halves of the list, and nothing already dealt
  // with.
  // ------------------------------------------------------------------------
  describe('the shopping list', () => {
    const panel = () => screen.getByTestId('kiosk-shopping');

    it('is still the third panel, and still says what it is', async () => {
      await renderBoard();
      expect(within(panel()).getByRole('heading', { name: 'Shopping list' })).toBeInTheDocument();
    });

    it('shows what the week needs and what the cook typed, together', async () => {
      // A board showing only the ad-hoc items would be actively misleading
      // about what needs buying.
      await renderBoard({
        entries: [mealNeeding('Salmon', { quantity: 2, unit: 'fillet' })],
        shopping: [makeShoppingItem({ id: 's1', name: 'Batteries' })],
      });

      expect(within(panel()).getByText('Batteries')).toBeInTheDocument();
      expect(within(panel()).getByText('Salmon')).toBeInTheDocument();
      expect(within(panel()).getByText('2 fillet')).toBeInTheDocument();
    });

    it('takes a ticked-off item off the fridge', async () => {
      await renderBoard({
        shopping: [
          makeShoppingItem({ id: 's1', name: 'Batteries' }),
          makeShoppingItem({ id: 's2', name: 'Kitchen Roll', status: 'bought' }),
        ],
      });

      expect(within(panel()).getByText('Batteries')).toBeInTheDocument();
      // Already in the trolley is not still to buy — the board is not the
      // place to relitigate that.
      expect(within(panel()).queryByText('Kitchen Roll')).not.toBeInTheDocument();
    });

    it('leaves out what the kitchen already covers', async () => {
      await renderBoard({
        items: [makeItem({ id: 'stock', name: 'Rice', quantity: 5, unit: 'cup' })],
        entries: [mealNeeding('Rice', { quantity: 1, unit: 'cup' })],
      });

      expect(within(panel()).queryByText('Rice')).not.toBeInTheDocument();
      expect(within(panel()).getByText(/Nothing to pick up/i)).toBeInTheDocument();
    });

    it('says so plainly when there is nothing to buy', async () => {
      await renderBoard();
      expect(within(panel()).getByText(/Nothing to pick up/i)).toBeInTheDocument();
      expect(within(panel()).queryAllByRole('listitem')).toHaveLength(0);
    });

    // The constraint that governs this whole page: the board is one screen.
    it('stops at the limit rather than growing off the screen', async () => {
      const many = Array.from({ length: KIOSK_SHOPPING_LIMIT + 3 }, (_, i) =>
        makeShoppingItem({ id: `s${i}`, name: `Thing ${i}` })
      );
      await renderBoard({ shopping: many });

      expect(within(panel()).queryAllByRole('listitem')).toHaveLength(KIOSK_SHOPPING_LIMIT);
      expect(within(panel()).getByText('Thing 0')).toBeInTheDocument();
      expect(within(panel()).queryByText(`Thing ${KIOSK_SHOPPING_LIMIT}`)).not.toBeInTheDocument();
      expect(within(panel()).getByText(/and 3 more/i)).toBeInTheDocument();
    });

    it('counts the derived half toward that limit too', async () => {
      // Otherwise four typed items plus six the week needs is ten rows on a
      // panel with room for four.
      const shopping = Array.from({ length: 2 }, (_, i) =>
        makeShoppingItem({ id: `s${i}`, name: `Typed ${i}` })
      );
      const entries = Array.from({ length: 5 }, (_, i) =>
        mealNeeding(`Needed ${i}`, { id: `m${i}` })
      );
      await renderBoard({ shopping, entries });

      expect(within(panel()).queryAllByRole('listitem')).toHaveLength(KIOSK_SHOPPING_LIMIT);
      expect(within(panel()).getByText(/and 3 more/i)).toBeInTheDocument();
    });

    it('gives one errand one row when both halves name it', async () => {
      // Two "Milk" rows on a four-row board read as a rendering fault, not as
      // information. This is not the quantity merge the schema rules out: no
      // number is added, one row is dropped, and the meal plan page still shows
      // both with the note explaining the difference.
      await renderBoard({
        entries: [mealNeeding('Milk', { quantity: 200, unit: 'g' })],
        shopping: [makeShoppingItem({ id: 's1', name: 'Milk', quantity: 2, unit: 'l' })],
      });

      expect(within(panel()).getAllByText('Milk')).toHaveLength(1);
      // The typed row survives — it is the cook's own words — with its own
      // quantity untouched rather than summed with the computed one.
      expect(within(panel()).getByText('2 l')).toBeInTheDocument();
      expect(within(panel()).queryByText('200 g')).not.toBeInTheDocument();
    });

    it('leaves out a bare "1" that tells the cook nothing', async () => {
      await renderBoard({ shopping: [makeShoppingItem({ id: 's1', name: 'Batteries' })] });

      const row = within(panel()).getByText('Batteries').closest('li');
      expect(within(row).queryByText('1')).not.toBeInTheDocument();
    });
  });
});
