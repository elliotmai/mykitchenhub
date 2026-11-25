import {
  EVENT_STATUSES,
  addDay,
  addToMenu,
  isUpcoming,
  menuRecipes,
  newEvent,
  removeDay,
  removeFromMenu,
  shoppingLines,
  sortEvents,
  sortedDays,
  updateDay,
} from '../eventLogic';

let n = 0;
const id = () => `d${++n}`;
beforeEach(() => {
  n = 0;
});

const recipes = {
  r1: { id: 'r1', name: 'Green Rice', ingredients: [{ name: 'Rice' }, { name: 'Cilantro' }] },
  r2: {
    id: 'r2',
    name: "Grandma's Ribs",
    ingredients: [{ name: 'Pork ribs' }, { name: 'Onions' }],
  },
  r3: { id: 'r3', name: 'Ribs', ingredients: ['Pork ribs', 'BBQ sauce'] },
};
const dishes = [
  { id: 'rib', name: 'Ribs', favorite: recipes.r3, recipes: [recipes.r3, recipes.r2] },
];

describe('an event', () => {
  it('starts with one day, dated or not', () => {
    expect(
      newEvent({ name: ' Thanksgiving ', date: '2026-11-26', guests: 'The Smiths' }, id)
    ).toEqual({
      name: 'Thanksgiving',
      guests: 'The Smiths',
      notes: '',
      days: [
        { id: 'd1', name: 'Thanksgiving', date: '2026-11-26', status: 'Not Started', menu: [] },
      ],
    });
    expect(newEvent({ name: 'Game night', date: 'someday' }, id).days[0].date).toBeNull();
    expect(newEvent({ name: '  ' })).toBeNull();
  });

  it('gains, changes and loses days', () => {
    let e = newEvent({ name: 'Christmas', date: '2026-12-25' }, id);
    e = addDay(e, { name: 'Christmas Eve', date: '2026-12-24' }, id);
    e = addDay(e, {}, id);
    expect(e.days.map((d) => d.name)).toEqual(['Christmas', 'Christmas Eve', 'Day 3']);
    expect(sortedDays(e).map((d) => d.id)).toEqual(['d2', 'd1', 'd3']);
    e = updateDay(e, 'd3', { name: 'Boxing Day', date: '2026-12-26', status: 'Shopping' });
    expect(e.days[2]).toMatchObject({ name: 'Boxing Day', date: '2026-12-26', status: 'Shopping' });
    e = updateDay(e, 'd3', { status: 'Napping', date: '', name: '' });
    expect(e.days[2]).toMatchObject({ status: 'Shopping', date: null, name: 'Boxing Day' });
    expect(removeDay(e, 'd2').days.map((d) => d.id)).toEqual(['d1', 'd3']);
    expect(EVENT_STATUSES).toContain('Done');
  });

  it('puts dishes and recipes on a menu once each', () => {
    let e = newEvent({ name: 'BBQ' }, id);
    e = addToMenu(e, 'd1', { dishId: 'rib', label: 'Ribs' });
    e = addToMenu(e, 'd1', { dishId: 'rib' });
    e = addToMenu(e, 'd1', { recipeId: 'r1', label: 'Green Rice' });
    e = addToMenu(e, 'd1', {});
    expect(e.days[0].menu).toEqual([
      { dishId: 'rib', label: 'Ribs' },
      { recipeId: 'r1', label: 'Green Rice' },
    ]);
    expect(removeFromMenu(e, 'd1', 0).days[0].menu).toEqual([
      { recipeId: 'r1', label: 'Green Rice' },
    ]);
  });
});

describe('when events happen', () => {
  const today = '2026-11-25';
  const ev = (name, ...dates) => ({
    name,
    days: dates.map((date, i) => ({ id: `${name}${i}`, date })),
  });

  it('is upcoming with any day ahead or undated', () => {
    expect(isUpcoming(ev('a', '2026-11-25'), today)).toBe(true);
    expect(isUpcoming(ev('b', '2026-01-01', null), today)).toBe(true);
    expect(isUpcoming(ev('c', '2025-12-25'), today)).toBe(false);
    expect(isUpcoming({ name: 'd', days: [] }, today)).toBe(true);
  });

  it('lists the soonest first, undated next, and past ones newest first', () => {
    const { upcoming, past } = sortEvents(
      [
        ev('Undated', null),
        ev('Christmas', '2026-12-25'),
        ev('Thanksgiving', '2026-11-26'),
        ev('Old', '2025-07-04'),
        ev('Older', '2025-02-08'),
      ],
      today
    );
    expect(upcoming.map((e) => e.name)).toEqual(['Thanksgiving', 'Christmas', 'Undated']);
    expect(past.map((e) => e.name)).toEqual(['Old', 'Older']);
  });
});

describe('menus feed the shopping list', () => {
  const day = {
    id: 'd',
    menu: [
      { dishId: 'rib', label: 'Ribs' },
      { recipeId: 'r1' },
      { recipeId: 'gone', label: 'Old Dip' },
    ],
  };

  it('cooks a dish from its favourite recipe', () => {
    expect(menuRecipes(day, dishes, recipes).map((m) => [m.label, m.recipe?.id ?? null])).toEqual([
      ['Ribs', 'r3'],
      ['Green Rice', 'r1'],
      ['Old Dip', null],
    ]);
    expect(menuRecipes({ menu: [{}] })[0].label).toBe('A recipe no longer in the library');
  });

  it('lists each ingredient once, by name, skipping what is already waiting on the list', () => {
    const onList = [
      { name: 'BBQ sauce', status: 'pending' },
      { name: 'Rice', status: 'bought' },
    ];
    expect(shoppingLines([day], dishes, recipes, onList, 'e1')).toEqual([
      { name: 'Pork ribs', recipeName: 'Ribs', eventId: 'e1' },
      { name: 'Rice', recipeName: 'Green Rice', eventId: 'e1' },
      { name: 'Cilantro', recipeName: 'Green Rice', eventId: 'e1' },
    ]);
    expect(shoppingLines([day, day], dishes, recipes).length).toBe(4);
  });
});

describe('who is bringing what, and what a dish line holds', () => {
  const { addToMenu, setBringing } = require('../eventLogic');
  const event = { id: 'e', name: 'Party', days: [{ id: 'd1', name: 'Day', menu: [] }] };

  it('keeps a dish line’s recipes so a guest may read them', () => {
    const next = addToMenu(event, 'd1', {
      dishId: 'lasagna',
      label: 'Lasagna',
      recipeIds: ['a', 'b'],
    });
    expect(next.days[0].menu[0]).toMatchObject({ dishId: 'lasagna', recipeIds: ['a', 'b'] });
    const plain = addToMenu(event, 'd1', { recipeId: 'a', label: 'A', recipeIds: ['x'] });
    expect(plain.days[0].menu[0].recipeIds).toBeUndefined();
  });

  it('sets and clears who is bringing a line', () => {
    const withLine = addToMenu(event, 'd1', { recipeId: 'a', label: 'A' });
    const bringing = setBringing(withLine, 'd1', 0, '  Aunt Sue ');
    expect(bringing.days[0].menu[0].bringing).toBe('Aunt Sue');
    expect(setBringing(bringing, 'd1', 0, '').days[0].menu[0]).not.toHaveProperty('bringing');
  });
});
