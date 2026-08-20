// The fridge board: what it shows, what it leaves out, and what it says when
// it cannot keep the screen awake.

import React from 'react';

import Kiosk, { KIOSK_VISIBLE_ROWS } from '../Kiosk';
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

  // The panel scrolls, so nothing is cut off. What it must not do is quietly
  // show a subset — the old behaviour — because a board that hides two items
  // behind a count sends you to another device to read them.
  it('keeps every expiring item on the board, however many there are', async () => {
    const many = Array.from({ length: KIOSK_VISIBLE_ROWS + 4 }, (_, i) =>
      makeItem({ id: `x${i}`, name: `Item ${i}`, expiresAt: daysFromNow(1) })
    );
    await renderBoard({ items: many });

    expect(screen.getByText('Item 0')).toBeInTheDocument();
    expect(screen.getByText(`Item ${KIOSK_VISIBLE_ROWS + 3}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('kiosk-eat-list')).getAllByRole('listitem')).toHaveLength(
      KIOSK_VISIBLE_ROWS + 4
    );
  });

  // A scrollbar is not visible from two metres away, so the panel says it.
  it('says how many more are below the fold', async () => {
    const many = Array.from({ length: KIOSK_VISIBLE_ROWS + 4 }, (_, i) =>
      makeItem({ id: `x${i}`, name: `Item ${i}`, expiresAt: daysFromNow(1) })
    );
    await renderBoard({ items: many });

    expect(screen.getByText(/scroll for 4 more/i)).toBeInTheDocument();
  });

  it('stays quiet when the whole list already fits', async () => {
    await renderBoard();

    expect(screen.queryByText(/scroll for/i)).not.toBeInTheDocument();
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

    it('keeps the whole errand list on the board, however long it is', async () => {
      const many = Array.from({ length: KIOSK_VISIBLE_ROWS + 3 }, (_, i) =>
        makeShoppingItem({ id: `s${i}`, name: `Thing ${i}` })
      );
      await renderBoard({ shopping: many });

      expect(within(panel()).getAllByRole('listitem')).toHaveLength(KIOSK_VISIBLE_ROWS + 3);
      expect(within(panel()).getByText(`Thing ${KIOSK_VISIBLE_ROWS + 2}`)).toBeInTheDocument();
      expect(within(panel()).getByText(/scroll for 3 more/i)).toBeInTheDocument();
    });

    it('counts the derived half toward what is below the fold too', async () => {
      const shopping = Array.from({ length: 2 }, (_, i) =>
        makeShoppingItem({ id: `s${i}`, name: `Typed ${i}` })
      );
      const entries = Array.from({ length: 5 }, (_, i) =>
        mealNeeding(`Needed ${i}`, { id: `m${i}` })
      );
      await renderBoard({ shopping, entries });

      expect(within(panel()).getAllByRole('listitem')).toHaveLength(7);
      expect(within(panel()).getByText(/scroll for 2 more/i)).toBeInTheDocument();
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

  describe('editing the list from the fridge', () => {
    const panel = () => screen.getByTestId('kiosk-shopping');

    // Adding is the only thing this surface does to the list. Ticking an item
    // off and taking one away both happen in the shop, on the phone in your
    // hand — and on a display anyone walks past, a button that deletes a row
    // is a thing an elbow can do. The phone and the Shopping List tab keep
    // both; this asserts the fridge does not.
    it('offers no way to tick a typed item off from the board', async () => {
      await renderBoard({
        shopping: [makeShoppingItem({ id: 's1', name: 'Batteries' })],
      });

      const row = within(panel()).getByText('Batteries').closest('li');
      expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    });

    it('offers no way to delete a row, typed or derived', async () => {
      await renderBoard({
        shopping: [makeShoppingItem({ id: 's1', name: 'Batteries' })],
        entries: [mealNeeding('Chorizo')],
      });

      const rows = within(panel()).getAllByRole('listitem');
      expect(rows.length).toBeGreaterThanOrEqual(2);
      rows.forEach((row) => {
        expect(within(row).queryByRole('button')).not.toBeInTheDocument();
        expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
      });
    });

    it('never writes to an item just from rendering the board', async () => {
      await renderBoard({
        shopping: [makeShoppingItem({ id: 's1', name: 'Batteries' })],
      });

      expect(fs.updateDoc).not.toHaveBeenCalled();
      expect(fs.deleteDoc).not.toHaveBeenCalled();
    });

    it('adds what the cook typed, and clears the field for the next one', async () => {
      const { user } = await renderBoard();

      const field = screen.getByLabelText(/add an item to the shopping list/i);
      await user.type(field, 'Kitchen roll');
      await user.click(screen.getByRole('button', { name: /add to the shopping list/i }));

      await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
      expect(fs.addDoc.mock.calls.at(-1)[1]).toMatchObject({ name: 'Kitchen roll' });
      await waitFor(() => expect(field).toHaveValue(''));
    });

    it('will not add a blank line', async () => {
      const { user } = await renderBoard();

      await user.type(screen.getByLabelText(/add an item to the shopping list/i), '   ');

      expect(screen.getByRole('button', { name: /add to the shopping list/i })).toBeDisabled();
      expect(fs.addDoc).not.toHaveBeenCalled();
    });

    it('keeps what was typed when the write is refused, so it is not lost', async () => {
      const { user } = await renderBoard();
      fs.addDoc.mockRejectedValueOnce(
        Object.assign(new Error('nope'), { code: 'permission-denied' })
      );

      const field = screen.getByLabelText(/add an item to the shopping list/i);
      await user.type(field, 'Kitchen roll');
      await user.click(screen.getByRole('button', { name: /add to the shopping list/i }));

      await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
      expect(field).toHaveValue('Kitchen roll');
    });

    // The add field is the reason to walk over to the board, so it must be
    // there before there is a list — not appear once one exists.
    it('offers the field even when there is nothing to buy', async () => {
      await renderBoard();

      expect(within(panel()).getByText(/nothing to pick up/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/add an item to the shopping list/i)).toBeInTheDocument();
    });
  });

  describe('opening a recipe from the week', () => {
    it('links a planned meal to its recipe', async () => {
      await renderBoard({
        entries: [
          makeMealPlanEntry({
            id: 'm1',
            date: dayKey(0),
            recipeId: 'r-salmon',
            recipeName: 'Sheet Pan Salmon',
          }),
        ],
      });

      expect(screen.getByRole('link', { name: 'Sheet Pan Salmon' })).toHaveAttribute(
        'href',
        '/recipes?recipe=r-salmon'
      );
    });

    // A meal typed straight onto the plan has no recipe behind it. A link that
    // goes nowhere is worse than none on a wall display: the tap is the only
    // way to discover it does nothing.
    it('leaves a meal with no recipe behind it as plain text', async () => {
      await renderBoard({
        entries: [
          makeMealPlanEntry({
            id: 'm1',
            date: dayKey(0),
            recipeId: null,
            recipeName: 'Leftovers',
          }),
        ],
      });

      expect(screen.getByText('Leftovers')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Leftovers' })).not.toBeInTheDocument();
    });

    it('links each meal separately when a day holds two', async () => {
      await renderBoard({
        entries: [
          makeMealPlanEntry({
            id: 'm1',
            date: dayKey(0),
            recipeId: 'r-1',
            recipeName: 'Porridge',
            mealType: 'breakfast',
          }),
          makeMealPlanEntry({
            id: 'm2',
            date: dayKey(0),
            recipeId: 'r-2',
            recipeName: 'Salmon',
            mealType: 'dinner',
          }),
        ],
      });

      expect(screen.getByRole('link', { name: 'Porridge' })).toHaveAttribute(
        'href',
        '/recipes?recipe=r-1'
      );
      expect(screen.getByRole('link', { name: 'Salmon' })).toHaveAttribute(
        'href',
        '/recipes?recipe=r-2'
      );
    });
  });
});

/* The count beside each panel's name. It answers the question you ask from
   across the room — is there anything to do — without reading the list. */
describe('the counts on the two right-column panels', () => {
  const eatCount = () => screen.queryByTestId('kiosk-eat-count');
  const shoppingCount = () => screen.queryByTestId('kiosk-shopping-count');

  it('counts everything going off, not just what fits on screen', async () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      makeItem({ id: `x${i}`, name: `Going Off ${i}`, expiresAt: daysFromNow(1) })
    );
    await renderBoard({ items });

    expect(eatCount()).toHaveTextContent('9');
  });

  it('counts both halves of the errand list', async () => {
    await renderBoard({
      shopping: [
        makeShoppingItem({ id: 's1', name: 'Batteries' }),
        makeShoppingItem({ id: 's2', name: 'Kitchen Roll' }),
      ],
      entries: [mealNeeding('Chorizo')],
    });

    // Two typed and one the week worked out — the panel shows all three as one
    // list of errands, so the count has to agree with it.
    expect(shoppingCount()).toHaveTextContent('3');
  });

  it('leaves out anything already ticked off', async () => {
    await renderBoard({
      shopping: [
        makeShoppingItem({ id: 's1', name: 'Batteries' }),
        makeShoppingItem({ id: 's2', name: 'Kitchen Roll', status: 'bought' }),
      ],
    });

    expect(shoppingCount()).toHaveTextContent('1');
  });

  it('agrees with the number of rows actually rendered', async () => {
    await renderBoard({
      shopping: Array.from({ length: 5 }, (_, i) =>
        makeShoppingItem({ id: `s${i}`, name: `Thing ${i}` })
      ),
    });

    const rows = within(screen.getByTestId('kiosk-shopping-list')).getAllByRole('listitem');
    expect(shoppingCount()).toHaveTextContent(String(rows.length));
  });

  it('shows no count rather than a nought when there is nothing to do', async () => {
    await renderBoard({ items: [], shopping: [] });

    // Both panels already say so in words; a 0 beside the name is one more
    // thing to focus on and dismiss from across a kitchen.
    expect(eatCount()).not.toBeInTheDocument();
    expect(shoppingCount()).not.toBeInTheDocument();
    expect(screen.getByText(/nothing about to go off/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing to pick up/i)).toBeInTheDocument();
  });

  it('counts one errand once when both halves name it', async () => {
    await renderBoard({
      entries: [mealNeeding('Milk', { quantity: 200, unit: 'g' })],
      shopping: [makeShoppingItem({ id: 's1', name: 'Milk', quantity: 2, unit: 'l' })],
    });

    // One row on the board, so one on the count — the two must not disagree.
    const rows = within(screen.getByTestId('kiosk-shopping-list')).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(shoppingCount()).toHaveTextContent('1');
  });
});
