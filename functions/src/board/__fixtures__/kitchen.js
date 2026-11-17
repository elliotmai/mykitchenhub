// One cook's kitchen, as stored documents, for the board API tests.
//
// The clock is 03:00 UTC on Wednesday 18 November 2026, which is still
// Tuesday 17 November in Chicago — so any test that reads "today" off the UTC
// clock instead of the cook's gets the wrong day, and says so.

const { hashToken } = require('../auth');

const NOW = new Date('2026-11-18T03:00:00Z');
const TODAY = '2026-11-17'; // in America/Chicago
const TOKEN = 'k'.repeat(43);
const OTHER_TOKEN = 'o'.repeat(43);
const UID = 'cook-1';
const OTHER_UID = 'cook-2';

/** A Firestore Timestamp, as the admin SDK hands one back. */
const ts = (iso) => {
  const date = new Date(iso);
  return { toDate: () => new Date(date), seconds: Math.floor(date.getTime() / 1000) };
};

const entry = (date, mealType, recipeName, recipeId, usesIngredients = [], status = 'planned') => ({
  date,
  mealType,
  recipeName,
  recipeId,
  servings: 2,
  status,
  source: 'manual',
  usesIngredients,
  batchGroup: null,
  notes: '',
  planId: null,
});

const uses = (name, quantity, unit) => ({ name, normalized: name, quantity, unit });

const ENTRIES = {
  // Monday: before today, but still this week and not yet cooked — the app's
  // shopping list counts it, the board's meals do not.
  'e-mon': entry('2026-11-16', 'dinner', 'Beef Tacos', 'r-tacos', [
    uses('ground beef', 10, 'oz'),
    uses('tortillas', 8, ''),
  ]),
  'e-tue-dinner': entry('2026-11-17', 'dinner', 'Chili', 'r-chili', [
    uses('ground beef', 1, 'lb'),
    uses('onions', 2, ''),
  ]),
  'e-tue-lunch': entry('2026-11-17', 'lunch', 'Salad', null, [uses('lettuce', 1, 'head')]),
  'e-tue-breakfast': entry(
    '2026-11-17',
    'breakfast',
    'Oats',
    'r-oats',
    [uses('oats', 1, 'cup')],
    'cooked'
  ),
  'e-sun': entry('2026-11-22', 'dinner', 'Beef Tacos', 'r-tacos', [uses('ground beef', 10, 'oz')]),
  // Next Monday: inside the seven days of meals, outside the shopping week.
  'e-next-mon': entry('2026-11-23', 'dinner', 'Salmon', 'r-missing', [uses('salmon', 2, 'fillet')]),
  'e-last-week': entry('2026-11-10', 'dinner', 'Old', 'r-old', [uses('flour', 1, 'cup')]),
  'e-too-far': entry('2026-11-24', 'dinner', 'Later', 'r-later', []),
};

const item = (name, quantity, unit, expiresAt) => ({
  name,
  normalized: name.toLowerCase(),
  quantity,
  unit,
  locationType: 'fridge',
  source: 'manual',
  expiresAt,
});

const INVENTORY = {
  'i-onions': item('onions', 3, '', ts('2026-12-30T12:00:00Z')),
  'i-milk': item('Milk', 1, 'gal', ts('2026-11-18T18:00:00Z')),
  // 23:00 Chicago on the 17th is the 18th in UTC: still "today" for the cook.
  'i-spinach': item('Spinach', 1, 'bag', ts('2026-11-18T05:00:00Z')),
  'i-yogurt': item('Yogurt', 2, 'cup', ts('2026-11-15T15:00:00Z')),
  'i-rice': item('Rice', 2, 'lb', ts('2026-11-30T15:00:00Z')),
};

const shopping = (name, status, createdAt, boughtAt = null, extra = {}) => ({
  name,
  normalized: name.toLowerCase(),
  quantity: 1,
  unit: '',
  notes: '',
  status,
  source: 'manual',
  createdAt,
  boughtAt,
  ...extra,
});

const SHOPPING = {
  's-batteries': shopping('Batteries', 'pending', '2026-11-17T10:00:00Z', null, {
    quantity: 4,
    unit: 'pack',
  }),
  's-tortillas': shopping('Tortillas', 'pending', '2026-11-16T10:00:00Z'),
  's-milk': shopping('Milk', 'bought', '2026-11-15T10:00:00Z', ts('2026-11-17T20:00:00Z')),
  's-bread': shopping('Bread', 'bought', '2026-11-14T10:00:00Z', ts('2026-11-16T20:00:00Z')),
};

const RECIPES = {
  'r-tacos': {
    name: 'Beef Tacos',
    description: 'Crispy, quick and weeknight-friendly.\nServe with lime.',
    prepTime: 10,
    cookTime: 25,
    servings: 2,
    nutrition: { calories: '780 kcal' },
    ingredients: [
      { name: 'ground beef', quantity: 10, unit: 'oz', normalized: 'ground beef' },
      { name: 'tortillas', quantity: 8, unit: '', normalized: 'tortillas' },
      { name: 'lime', quantity: 0.5, unit: '', normalized: 'lime' },
    ],
    instructions: [
      'Brown the beef: Cook the beef in a hot pan for 8–10 minutes, breaking it up.',
      'Warm the tortillas.\nFill and serve.',
    ],
    source: 'hellofresh',
    tags: ['hellofresh'],
    difficulty: 'easy',
    timesCooked: 0,
  },
  'r-chili': {
    name: 'Chili',
    prepTime: null,
    cookTime: 60,
    servings: 4,
    ingredients: [
      {
        name: 'ground beef',
        quantity: 1,
        unit: 'lb',
        normalized: 'ground beef',
        text: '1 lb lean ground beef',
      },
    ],
    instructions: '1. Brown the beef. 2. Add the beans and simmer for 45 minutes.',
    source: 'legacy',
    tags: ['legacy'],
    difficulty: 'medium',
    timesCooked: 3,
  },
  'r-oats': {
    name: 'Oats',
    servings: 1,
    ingredients: [],
    instructions: ['Cook the oats.'],
    source: 'user-created',
    tags: [],
    difficulty: 'easy',
    timesCooked: 0,
  },
  'r-later': { name: 'Later', servings: 2, ingredients: [], instructions: [] },
  'r-old': { name: 'Old', servings: 2, ingredients: [], instructions: [] },
};

const prefix = (base, docs) =>
  Object.fromEntries(Object.entries(docs).map(([id, data]) => [`${base}/${id}`, data]));

/** Every document, keyed by path, including a second cook who must never show up. */
const kitchenDocs = ({ profile = {} } = {}) => ({
  [`users/${UID}`]: { email: 'cook@example.com', apiTokenHashes: [hashToken(TOKEN)], ...profile },
  [`users/${OTHER_UID}`]: { email: 'other@example.com', apiTokenHash: hashToken(OTHER_TOKEN) },
  ...prefix(`users/${UID}/mealPlanEntries`, ENTRIES),
  ...prefix(`users/${UID}/inventory`, INVENTORY),
  ...prefix(`users/${UID}/shoppingItems`, SHOPPING),
  ...prefix(`users/${OTHER_UID}/shoppingItems`, {
    'their-item': shopping('Caviar', 'pending', '2026-11-17T10:00:00Z'),
  }),
  ...prefix(`users/${OTHER_UID}/mealPlanEntries`, {
    'their-meal': entry('2026-11-17', 'dinner', 'Lobster', 'r-tacos', [uses('lobster', 1, '')]),
  }),
  ...prefix('recipes', RECIPES),
});

const asDocs = (docs) => Object.entries(docs).map(([id, data]) => ({ id, ...data }));

module.exports = {
  NOW,
  TODAY,
  TOKEN,
  OTHER_TOKEN,
  UID,
  OTHER_UID,
  ts,
  ENTRIES,
  INVENTORY,
  SHOPPING,
  RECIPES,
  kitchenDocs,
  asDocs,
};
