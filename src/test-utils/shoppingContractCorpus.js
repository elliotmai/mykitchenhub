// One corpus of weeks, kitchens and typed lists, run through both copies of
// the shopping list arithmetic by shoppingList.contract.test.js:
//
//   src/hooks/useMealPlan.js, src/hooks/useShoppingList.js   (the app)
//   functions/src/board/shoppingList.js                      (the board API)
//
// Written in CommonJS so either side can load it. Add a case here whenever
// you touch either copy: a rule exercised in only one of them is a rule that
// can drift, and the board API promises Fridge Board the list exactly as
// KitchenHub shows it.

const uses = (name, quantity, unit = '', normalized) => ({
  name,
  normalized: normalized ?? String(name).toLowerCase(),
  quantity,
  unit,
});

const meal = (date, mealType, usesIngredients, status = 'planned') => ({
  date,
  mealType,
  recipeName: `${mealType} on ${date}`,
  status,
  usesIngredients,
});

const stock = (name, quantity, unit = '') => ({
  name,
  normalized: name.toLowerCase(),
  quantity,
  unit,
});

const typed = (id, name, extra = {}) => ({
  id,
  name,
  normalized: name.trim().toLowerCase(),
  quantity: 1,
  unit: '',
  notes: '',
  status: 'pending',
  source: 'manual',
  ...extra,
});

/** { name, entries, inventory, manualItems } */
const CASES = [
  { name: 'nothing at all', entries: [], inventory: [], manualItems: [] },
  {
    name: 'one meal, empty kitchen',
    entries: [meal('2026-11-17', 'dinner', [uses('Salmon', 2, 'fillet'), uses('rice', 1, 'cup')])],
    inventory: [],
    manualItems: [],
  },
  {
    name: 'quantities sum across meals in the same unit',
    entries: [
      meal('2026-11-16', 'dinner', [uses('ground beef', 10, 'oz')]),
      meal('2026-11-22', 'dinner', [uses('Ground Beef', 10, 'oz', 'ground beef')]),
    ],
    inventory: [],
    manualItems: [],
  },
  {
    name: 'different units stay separate',
    entries: [
      meal('2026-11-17', 'dinner', [uses('flour', 2, 'cup')]),
      meal('2026-11-18', 'dinner', [uses('flour', 200, 'g')]),
    ],
    inventory: [stock('flour', 1, 'cup')],
    manualItems: [],
  },
  {
    name: 'cooked and skipped meals buy nothing',
    entries: [
      meal('2026-11-17', 'breakfast', [uses('oats', 1, 'cup')], 'cooked'),
      meal('2026-11-17', 'lunch', [uses('bread', 2, 'slice')], 'skipped'),
      meal('2026-11-17', 'dinner', [uses('eggs', 2)]),
    ],
    inventory: [],
    manualItems: [],
  },
  {
    name: 'stock fully covers, partly covers, or is in another unit',
    entries: [
      meal('2026-11-17', 'dinner', [
        uses('onions', 2),
        uses('milk', 2, 'cup'),
        uses('butter', 3, 'tbsp'),
      ]),
    ],
    inventory: [stock('Onions', 3), stock('milk', 1, 'cup'), stock('butter', 1, 'lb')],
    manualItems: [],
  },
  {
    name: 'unitless stock counts toward a measured need',
    entries: [meal('2026-11-17', 'dinner', [uses('garlic', 3, 'clove')])],
    inventory: [stock('garlic', 4)],
    manualItems: [],
  },
  {
    name: 'fractional quantities round to two places',
    entries: [
      meal('2026-11-17', 'dinner', [uses('cream', 1 / 3, 'cup')]),
      meal('2026-11-18', 'dinner', [uses('cream', 1 / 3, 'cup')]),
    ],
    inventory: [],
    manualItems: [],
  },
  {
    name: 'ingredients with no name, no quantity or no list',
    entries: [
      meal('2026-11-17', 'dinner', [
        uses('', 1),
        { name: 'salt' },
        { normalized: 'pepper', quantity: 1 },
      ]),
      { date: '2026-11-18', mealType: 'dinner', status: 'planned' },
    ],
    inventory: [stock('salt', 0)],
    manualItems: [],
  },
  {
    name: 'a typed item claims the derived line of the same name',
    entries: [meal('2026-11-17', 'dinner', [uses('milk', 2, 'cup'), uses('tortillas', 8)])],
    inventory: [],
    manualItems: [typed('m1', 'Milk'), typed('m2', '  Batteries ', { quantity: 4, unit: 'pack' })],
  },
  {
    name: 'bought typed items are off the list and claim nothing',
    entries: [meal('2026-11-17', 'dinner', [uses('milk', 2, 'cup')])],
    inventory: [],
    manualItems: [
      typed('m1', 'Milk', { status: 'bought' }),
      typed('m2', 'Jam', { status: 'bought' }),
    ],
  },
  {
    name: 'typed quantities and units label as the app does',
    entries: [],
    inventory: [],
    manualItems: [
      typed('a', 'Eggs', { quantity: 12 }),
      typed('b', 'Rice', { quantity: 1, unit: 'kg' }),
      typed('c', 'Foil', { quantity: 0, unit: 'roll' }),
      typed('d', 'Bread'),
    ],
  },
];

/** Names for the aisle lookup: exact, plural/singular, keyword and unknown. */
const SECTION_NAMES = [
  'milk',
  'Milk',
  '  eggs ',
  'egg',
  'tomato',
  'frozen peas',
  'chicken thighs',
  'orange juice',
  'sourdough loaf',
  'smoked salmon',
  'greek yoghurt',
  'tinned tomatoes',
  'olive oil',
  'batteries',
  'birthday cake',
  '',
  null,
  'ice cream',
  'pizza',
  'soy sauce',
];

/** Inputs for buildShoppingItem, as the add box and the board API send them. */
const ADD_INPUTS = [
  { name: 'Milk' },
  { name: '  Oat Milk  ' },
  { name: '' },
  { name: '   ' },
  {},
  { name: 'Eggs', quantity: '12', unit: ' box ', notes: ' free range ' },
  { name: 'Flour', quantity: 0 },
  { name: 'Flour', quantity: -2 },
  { name: 'Flour', quantity: 'lots' },
  { name: 'Cream', quantity: 1 / 3 },
];

module.exports = { CASES, SECTION_NAMES, ADD_INPUTS };
