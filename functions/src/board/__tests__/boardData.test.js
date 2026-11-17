/**
 * The board payload, built from plain documents — no Firestore.
 *
 * Pins the full contract Fridge Board is written against, field by field.
 */

const {
  NOW,
  TODAY,
  ENTRIES,
  INVENTORY,
  SHOPPING,
  RECIPES,
  asDocs,
  ts,
} = require('../__fixtures__/kitchen');
const {
  buildBoard,
  boardWindow,
  shoppingRows,
  manualRow,
  derivedId,
  expiringItems,
} = require('../boardData');
const {
  shiftDayKey,
  startOfWeekKey,
  todayIn,
  resolveTimeZone,
  DEFAULT_TIME_ZONE,
} = require('../dates');

const TZ = 'America/Chicago';

const sources = () => ({
  entries: asDocs(ENTRIES),
  inventory: asDocs(INVENTORY),
  manualItems: asDocs(SHOPPING).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  recipesById: RECIPES,
});

describe('days', () => {
  it("reads today off the cook's clock, not UTC", () => {
    expect(todayIn(TZ, NOW)).toBe(TODAY);
    expect(todayIn('UTC', NOW)).toBe('2026-11-18');
  });

  it.each([
    ['2026-11-16', '2026-11-16'], // Monday
    ['2026-11-17', '2026-11-16'],
    ['2026-11-22', '2026-11-16'], // Sunday belongs to the week before it
    ['2026-03-01', '2026-02-23'],
  ])('the week containing %s starts %s', (day, monday) => {
    expect(startOfWeekKey(day)).toBe(monday);
  });

  it('shifts across a month, a year and a DST change by calendar day', () => {
    expect(shiftDayKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2026-03-07', 7)).toBe('2026-03-14');
    expect(shiftDayKey('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('defaults the timezone to America/Chicago', () => {
    expect(DEFAULT_TIME_ZONE).toBe('America/Chicago');
    expect(resolveTimeZone(undefined)).toBe('America/Chicago');
    expect(resolveTimeZone('')).toBe('America/Chicago');
    expect(resolveTimeZone('Not/AZone')).toBe('America/Chicago');
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('covers seven days of meals and the Monday-to-Sunday shopping week', () => {
    expect(boardWindow(TODAY)).toEqual({
      today: TODAY,
      mealsFrom: '2026-11-17',
      mealsTo: '2026-11-23',
      weekStart: '2026-11-16',
      weekEnd: '2026-11-22',
    });
  });
});

describe('buildBoard', () => {
  const board = buildBoard(sources(), { now: NOW, timeZone: TZ });

  it('lists today and the next six days of meals, in eating order', () => {
    expect(board.today).toBe(TODAY);
    expect(board.meals).toEqual([
      { date: '2026-11-17', type: 'Breakfast', name: 'Oats', recipeId: 'r-oats', status: 'cooked' },
      { date: '2026-11-17', type: 'Lunch', name: 'Salad', recipeId: null, status: 'planned' },
      { date: '2026-11-17', type: 'Dinner', name: 'Chili', recipeId: 'r-chili', status: 'planned' },
      {
        date: '2026-11-22',
        type: 'Dinner',
        name: 'Beef Tacos',
        recipeId: 'r-tacos',
        status: 'planned',
      },
      {
        date: '2026-11-23',
        type: 'Dinner',
        name: 'Salmon',
        recipeId: 'r-missing',
        status: 'planned',
      },
    ]);
  });

  it('includes exactly the recipes those meals reference, leaving out a deleted one', () => {
    expect(Object.keys(board.recipes).sort()).toEqual(['r-chili', 'r-oats', 'r-tacos']);
    expect(board.recipes['r-tacos']).toEqual({
      name: 'Beef Tacos',
      sub: 'Crispy, quick and weeknight-friendly.',
      time: '35 min',
      serves: 2,
      cal: 780,
      ingredients: ['10 oz ground beef', '8 tortillas', '1/2 lime'],
      steps: [
        {
          title: 'Brown the beef',
          text: ['Cook the beef in a hot pan for 8–10 minutes, breaking it up.'],
          uses: [],
          timer: 8,
        },
        { title: 'Step 2', text: ['Warm the tortillas.', 'Fill and serve.'], uses: [] },
      ],
    });
    // A legacy blob, split on its own numbering.
    expect(board.recipes['r-chili']).toEqual({
      name: 'Chili',
      sub: null,
      time: '1 hr',
      serves: 4,
      cal: null,
      ingredients: ['1 lb lean ground beef'],
      steps: [
        { title: 'Step 1', text: ['Brown the beef.'], uses: [] },
        {
          title: 'Step 2',
          text: ['Add the beans and simmer for 45 minutes.'],
          uses: [],
          timer: 45,
        },
      ],
    });
  });

  it("lists food going off within five days, soonest first, counting calendar days in the cook's zone", () => {
    expect(board.expiring).toEqual([
      { name: 'Yogurt', days: -2 },
      { name: 'Spinach', days: 0 },
      { name: 'Milk', days: 1 },
    ]);
  });

  it("gives the shopping list as KitchenHub shows it, in aisle order, then today's cart", () => {
    expect(board.shopping).toEqual([
      {
        id: 'meal:lettuce|head',
        name: 'lettuce',
        qty: '1 head',
        section: 'Produce',
        why: 'Salad',
        bought: false,
      },
      // Typed "Tortillas" wins over the week's 8 tortillas, as on the KitchenHub kiosk.
      {
        id: 'item:s-tortillas',
        name: 'Tortillas',
        qty: '',
        section: 'Bakery',
        why: null,
        bought: false,
      },
      // Same food, different units: two lines, never summed.
      {
        id: 'meal:ground beef|lb',
        name: 'ground beef',
        qty: '1 lb',
        section: 'Meat & Seafood',
        why: 'Chili',
        bought: false,
      },
      // Monday's tacos are past but not cooked, so they still count, as in the app.
      {
        id: 'meal:ground beef|oz',
        name: 'ground beef',
        qty: '20 oz',
        section: 'Meat & Seafood',
        why: 'Beef Tacos',
        bought: false,
      },
      {
        id: 'item:s-batteries',
        name: 'Batteries',
        qty: '4 pack',
        section: 'Other',
        why: null,
        bought: false,
      },
      // Ticked off this evening: in the cart. Bread, ticked yesterday, is not.
      {
        id: 'item:s-milk',
        name: 'Milk',
        qty: '',
        section: 'Dairy & Eggs',
        why: null,
        bought: true,
      },
    ]);
  });

  it('leaves out what the kitchen covers, cooked meals, and meals outside the week', () => {
    const names = board.shopping.map((row) => row.name.toLowerCase());
    expect(names).not.toContain('onions'); // 2 needed, 3 on hand
    expect(names).not.toContain('oats'); // breakfast is cooked
    expect(names).not.toContain('salmon'); // next Monday
    expect(names).not.toContain('flour'); // last week
    expect(names).not.toContain('bread'); // bought yesterday
  });

  it('returns empty sections for an empty kitchen', () => {
    expect(buildBoard({}, { now: NOW, timeZone: TZ })).toEqual({
      today: TODAY,
      meals: [],
      recipes: {},
      expiring: [],
      shopping: [],
    });
  });
});

describe('shopping rows', () => {
  it('names every meal a line is for, once each', () => {
    const entries = [
      {
        date: TODAY,
        mealType: 'dinner',
        recipeName: 'Pasta',
        status: 'planned',
        usesIngredients: [{ name: 'garlic', quantity: 2, unit: 'clove' }],
      },
      {
        date: TODAY,
        mealType: 'lunch',
        recipeName: 'Soup',
        status: 'planned',
        usesIngredients: [{ name: 'Garlic', quantity: 1, unit: 'clove' }],
      },
      {
        date: TODAY,
        mealType: 'snack',
        recipeName: 'Pasta',
        status: 'planned',
        usesIngredients: [{ name: 'garlic', quantity: 1, unit: 'clove' }],
      },
      {
        date: TODAY,
        mealType: 'breakfast',
        recipeName: 'Toast',
        status: 'skipped',
        usesIngredients: [{ name: 'garlic', quantity: 1, unit: 'clove' }],
      },
    ];
    expect(shoppingRows({ weekEntries: entries, today: TODAY, timeZone: TZ })).toEqual([
      {
        id: 'meal:garlic|clove',
        name: 'garlic',
        qty: '4 clove',
        section: 'Produce',
        why: 'Pasta, Soup',
        bought: false,
      },
    ]);
  });

  it('keeps an id stable across reads', () => {
    expect(derivedId({ normalized: 'ground beef', unit: 'OZ ' })).toBe('meal:ground beef|oz');
    expect(derivedId({ normalized: 'eggs', unit: '' })).toBe('meal:eggs');
  });

  it('shapes a freshly added item', () => {
    expect(
      manualRow({
        id: 'abc',
        name: 'Eggs',
        normalized: 'eggs',
        quantity: 1,
        unit: '',
        status: 'pending',
      })
    ).toEqual({
      id: 'item:abc',
      name: 'Eggs',
      qty: '',
      section: 'Dairy & Eggs',
      why: null,
      bought: false,
    });
  });

  it("reads boughtAt in the cook's zone: 20:00 Chicago is tomorrow in UTC, but bought today", () => {
    const milk = {
      id: 'm',
      name: 'Milk',
      normalized: 'milk',
      quantity: 1,
      unit: '',
      status: 'bought',
      boughtAt: ts('2026-11-18T02:00:00Z'),
    };
    expect(
      shoppingRows({ manualItems: [milk], today: TODAY, timeZone: TZ }).map((r) => r.bought)
    ).toEqual([true]);
    expect(shoppingRows({ manualItems: [milk], today: TODAY, timeZone: 'UTC' })).toEqual([]);
  });

  it('leaves out a bought item with no boughtAt', () => {
    const item = {
      id: 'x',
      name: 'Jam',
      normalized: 'jam',
      quantity: 1,
      unit: '',
      status: 'bought',
      boughtAt: null,
    };
    expect(shoppingRows({ manualItems: [item], today: TODAY, timeZone: TZ })).toEqual([]);
  });
});

describe('expiringItems', () => {
  it('skips items with no usable expiry', () => {
    expect(
      expiringItems([{ name: 'Salt' }, { name: 'Mystery', expiresAt: 'not a date' }], NOW, TZ)
    ).toEqual([]);
  });

  it('includes the fifth day and not the sixth', () => {
    const items = [
      { name: 'Day five', expiresAt: ts('2026-11-22T18:00:00Z') },
      { name: 'Day six', expiresAt: ts('2026-11-23T18:00:00Z') },
    ];
    expect(expiringItems(items, NOW, TZ)).toEqual([{ name: 'Day five', days: 5 }]);
  });
});
