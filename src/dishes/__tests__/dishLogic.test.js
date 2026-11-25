import {
  assignDishes,
  bracketKey,
  dishIdFor,
  dishKey,
  dishOf,
  groupDishes,
  newDishId,
  recipeToCook,
  resolveDish,
  singular,
} from '../dishLogic';

const r = (id, name, extra = {}) => ({ id, name, ...extra });

describe('dishKey: what a name means as a dish', () => {
  it.each([
    ['Lasagna', 'lasagna'],
    ["Grandma's Lasagna", 'lasagna'],
    ['Easy Lasagnas!', 'lasagna'],
    ['The Best Homemade Lasagna', 'lasagna'],
    ['LASAGNA (from the card)', 'lasagna'],
    ['Mac n Cheese', 'mac cheese'],
    ['Mac & Cheese', 'mac cheese'],
    ['Mac and Cheese', 'mac cheese'],
    ['Crème Brûlée', 'creme brulee'],
    ['Mashed Potatoes', 'mashed potato'],
    ['Ribs', 'rib'],
    ['Creamy Cajun chicken and corn chowder', 'cajun chicken corn chowder'],
    ['Hummus', 'hummus'],
    ['The Best', 'the best'],
  ])('%s → %s', (name, key) => {
    expect(dishKey(name)).toBe(key);
  });

  it('keeps different dishes apart', () => {
    expect(dishKey('Chili')).not.toBe(dishKey('Cream Cheese Chili Dip'));
    expect(dishKey('Green Rice')).not.toBe(dishKey('Cilantro Lime Rice'));
  });

  it('singularises sensibly', () => {
    expect(['berries', 'dishes', 'boxes', 'glass', 'bus', 'peas', 'ham'].map(singular)).toEqual([
      'berry',
      'dish',
      'box',
      'glass',
      'bus',
      'pea',
      'ham',
    ]);
  });

  it('reads a bracketed subtitle', () => {
    expect(bracketKey('Go Big Spud (Cheesy Loaded Potato Soup)')).toBe('cheesy loaded potato soup');
    expect(bracketKey('Chili')).toBeNull();
    expect(dishIdFor('cheesy loaded potato soup')).toBe('cheesy-loaded-potato-soup');
    expect(dishIdFor('')).toBe('untitled');
  });
});

describe('grouping recipes into dishes', () => {
  const recipes = [
    r('a', 'Lasagna', { timesCooked: 2 }),
    r('b', "Grandma's Lasagna", { timesCooked: 5 }),
    r('c', 'Easy lasagna'),
    r('d', 'Cheesy loaded potato soup'),
    r('e', 'Go Big Spud (Cheesy Loaded Potato Soup)'),
    r('f', 'Extra Veg (Add to Cilantro Lime Rice)'),
    r('g', 'Cilantro Lime Rice'),
    r('h', 'Chili'),
  ];

  it('puts the same food together, and keeps the rest apart', () => {
    const dishes = groupDishes(recipes);
    expect(dishes.map((d) => [d.name, d.recipes.map((x) => x.id)])).toEqual([
      ['Cheesy loaded potato soup', ['d', 'e']],
      ['Chili', ['h']],
      ['Cilantro Lime Rice', ['g']],
      ['Extra Veg (Add to Cilantro Lime Rice)', ['f']],
      ['Lasagna', ['b', 'a', 'c']],
    ]);
  });

  it('a bracketed subtitle only joins a dish another recipe already is', () => {
    expect(assignDishes([r('e', 'Go Big Spud (Cheesy Loaded Potato Soup)')]).e).toBe('go-big-spud');
  });

  it('puts the favourite first, else the most cooked', () => {
    const lasagna = groupDishes(recipes, { lasagna: { favoriteRecipeId: 'c' } }).find(
      (d) => d.id === 'lasagna'
    );
    expect(lasagna.recipes.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(recipeToCook(lasagna).id).toBe('c');
    expect(lasagna.favoriteId).toBe('c');
    const unset = groupDishes(recipes).find((d) => d.id === 'lasagna');
    expect(unset.favoriteId).toBeNull();
    expect(recipeToCook(unset).id).toBe('b');
    expect(recipeToCook(null)).toBeNull();
  });

  it('honours a recipe moved by hand, a renamed dish and a merge', () => {
    const docs = {
      lasagna: { name: 'Lasagne' },
      chili: { mergedInto: 'lasagna' },
    };
    const dishes = groupDishes([...recipes, r('i', 'Lasagna soup', { dishId: 'lasagna' })], docs);
    const lasagne = dishes.find((d) => d.id === 'lasagna');
    expect(lasagne.name).toBe('Lasagne');
    expect(lasagne.named).toBe(true);
    expect(lasagne.recipes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'h', 'i']);
    expect(dishOf(dishes, 'h').id).toBe('lasagna');
    expect(dishOf(dishes, 'nope')).toBeNull();
  });

  it('survives a merge loop', () => {
    expect(resolveDish('a', { a: { mergedInto: 'b' }, b: { mergedInto: 'a' } })).toBe('a');
    expect(resolveDish('x')).toBe('x');
  });

  it('names an unnamed dish after its plainest recipe, or its key', () => {
    const dishes = groupDishes([r('x', 'Lasagnas', { dishId: 'baked-pasta' })]);
    expect(dishes[0].name).toBe('Baked Pasta');
  });

  it('makes a fresh id for a new dish', () => {
    expect(newDishId('Sunday Roast', [])).toBe('sunday-roast');
    expect(newDishId('Sunday Roast', ['sunday-roast', 'sunday-roast-2'])).toBe('sunday-roast-3');
  });
});
