// src/test-utils/factories.js
// Builders for the app's Firestore documents.
//
// Every factory takes overrides and returns a complete, schema-valid document,
// so a test only states the field it actually cares about:
//
//   makeItem({ name: 'Milk', expiresAt: daysFromNow(1) })  // → critical
//
// Keep these in sync with firestore/SCHEMA_DOCUMENTATION.md.

import { Timestamp } from './mocks/firestore';

/** A Firestore Timestamp `n` days from now — negative for the past. */
export const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return Timestamp.fromDate(d);
};

let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

export const resetFactorySequence = () => {
  seq = 0;
};

// ---------------------------------------------------------------------------
// users/{userId}
// ---------------------------------------------------------------------------
export const makeUserProfile = (overrides = {}) => ({
  email: 'cook@example.com',
  displayName: 'Test Cook',
  createdAt: daysFromNow(-30),
  preferences: {
    dietaryRestrictions: [],
    // Matches what onUserCreate seeds and what the daily alert function reads.
    smsAlerts: {
      enabled: false,
      phoneNumber: '',
      time: '09:00',
    },
    notifications: {
      expiringSoon: true,
      mealPlanReminders: true,
      lowInventory: false,
    },
  },
  helloFresh: {
    active: false,
    deliveryDay: null,
    mealsPerWeek: 3,
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// users/{userId}/storageLocations/{locationId}
// ---------------------------------------------------------------------------
export const makeLocation = (overrides = {}) => ({
  id: nextId('loc'),
  label: 'Main Fridge',
  type: 'fridge',
  icon: '🧊',
  color: '#A8D5E2',
  order: 0,
  isDefault: true,
  createdAt: daysFromNow(-30),
  ...overrides,
});

/** The four locations seeded on signup. */
export const makeDefaultLocations = () => [
  makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge', icon: '🧊', order: 0 }),
  makeLocation({ id: 'loc-freezer', label: 'Freezer', type: 'freezer', icon: '❄️', order: 1 }),
  makeLocation({ id: 'loc-pantry', label: 'Pantry', type: 'pantry', icon: '🏺', order: 2 }),
  makeLocation({
    id: 'loc-counter',
    label: 'Counter',
    type: 'pantry',
    icon: '🍎',
    order: 3,
    isDefault: false,
  }),
];

// ---------------------------------------------------------------------------
// users/{userId}/inventory/{itemId}
// ---------------------------------------------------------------------------
export const makeItem = (overrides = {}) => {
  const name = overrides.name ?? 'Milk';
  return {
    id: nextId('item'),
    name,
    normalized: name.toLowerCase(),
    quantity: 1,
    unit: 'gal',
    locationId: 'loc-fridge',
    locationType: 'fridge',
    addedAt: daysFromNow(-1),
    expiresAt: daysFromNow(7),
    shelfLifeDays: 7,
    shelfLifeSource: 'default',
    notes: '',
    source: 'manual',
    purchaseHistory: [],
    totalTimesPurchased: 1,
    ...overrides,
  };
};

/** One item per expiration bucket — handy for colour-coding assertions. */
export const makeItemsAcrossExpirationStates = () => [
  makeItem({ name: 'Old Yogurt', expiresAt: daysFromNow(-2) }), // expired
  makeItem({ name: 'Fresh Fish', expiresAt: daysFromNow(1) }), // critical
  makeItem({ name: 'Spinach', expiresAt: daysFromNow(4) }), // warning
  makeItem({ name: 'Rice', expiresAt: daysFromNow(90) }), // safe
];

/** One entry of an item's `purchaseHistory[]`. */
export const makePurchase = (overrides = {}) => ({
  addedAt: daysFromNow(-7),
  quantity: 1,
  unit: 'gal',
  price: 4.29,
  store: 'Costco',
  ...overrides,
});

/**
 * An item with a purchase history, for the shopping analytics.
 *
 * `totalTimesPurchased` is kept consistent with the history length unless a
 * test deliberately overrides it.
 */
export const makeItemWithPurchases = (purchases = [], overrides = {}) =>
  makeItem({
    purchaseHistory: purchases,
    totalTimesPurchased: purchases.length,
    ...overrides,
  });

// ---------------------------------------------------------------------------
// users/{userId}/importHistory/{importId}
// ---------------------------------------------------------------------------
export const makeImportRecord = (overrides = {}) => ({
  id: nextId('import'),
  fileName: 'kitchen.csv',
  importedAt: daysFromNow(-1),
  itemsImported: 42,
  itemsSkipped: 3,
  status: 'completed',
  source: 'csv-import',
  errorCount: 3,
  errors: [{ row: 7, message: 'Missing quantity.' }],
  ...overrides,
});

// ---------------------------------------------------------------------------
// users/{userId}/notifications/{notificationId}
// ---------------------------------------------------------------------------
export const makeNotification = (overrides = {}) => ({
  id: nextId('notification'),
  type: 'waste-alert',
  title: '2 items to use up soon',
  body: 'spinach (today) and milk (tomorrow). Freeze what you can, or cook something.',
  // An ISO string, not a Timestamp — the alert function has a plain Date to
  // hand and writes one. This factory used to build a Timestamp, so nothing
  // exercised the shape the only writer actually produces.
  createdAt: new Date().toISOString(),
  read: false,
  channel: 'in-app',
  smsStatus: 'not-configured',
  itemIds: [],
  itemCount: 2,
  ...overrides,
});

// ---------------------------------------------------------------------------
// recipes/{recipeId}
// ---------------------------------------------------------------------------
/**
 * A recipe as the rules accept it.
 *
 * The field names are the ones `firestore.rules` requires on create: `name`
 * (not `title`), and a `source` drawn from the documented list — a recipe
 * keyed on `title` or sourced from 'manual'/'seed' is rejected.
 *
 * Legacy imports that carry only `title` still exist, which is why readers
 * fall back to it. They are also why nothing queries this collection with
 * `orderBy('name')`: Firestore drops documents missing the ordered field.
 */
export const makeRecipe = (overrides = {}) => {
  const name = overrides.name ?? 'Sheet Pan Salmon';
  const source = overrides.source ?? 'user-created';
  return {
    id: nextId('recipe'),
    name,
    source,
    // Only a recipe a cook added through the app carries an author. Legacy,
    // synced and seeded recipes have none — which is exactly what makes them
    // undeletable from the client, so the factory must not invent one.
    ...(source === 'user-created' ? { createdBy: 'test-uid' } : {}),
    ingredients: [
      { name: 'salmon', quantity: 2, unit: 'fillet', normalized: 'salmon' },
      { name: 'spinach', quantity: 1, unit: 'bag', normalized: 'spinach' },
    ],
    instructions: ['Heat oven to 400F.', 'Roast 15 minutes.'],
    tags: ['dinner', 'quick'],
    prepTime: 10,
    cookTime: 15,
    servings: 2,
    difficulty: 'easy',
    imageUrl: null,
    timesCooked: 0,
    createdAt: daysFromNow(-10),
    ...overrides,
  };
};

/** One recipe per source, for filter and permission assertions. */
export const makeRecipesAcrossSources = () => [
  makeRecipe({ name: 'My Weeknight Pasta', source: 'user-created' }),
  makeRecipe({ name: 'Grandma Chili', source: 'legacy', tags: ['legacy', 'dinner'] }),
  makeRecipe({ name: 'Spoon Curry', source: 'spoonacular', tags: ['curry'] }),
  makeRecipe({ name: 'Box Stir Fry', source: 'hellofresh', tags: ['quick'] }),
];

// ---------------------------------------------------------------------------
// syncMetadata/legacy-recipe-sync
// ---------------------------------------------------------------------------
export const makeSyncMetadata = (overrides = {}) => ({
  id: 'legacy-recipe-sync',
  currentStatus: 'idle',
  recipesToProcess: 100,
  recipesProcessed: 40,
  recipesImported: 35,
  recipesSkipped: 5,
  instructionSources: { spoonacular: 25, ai_generated: 10 },
  costAccumulated: 1.25,
  costLimitUsd: 10,
  lastSyncTimestamp: daysFromNow(-1),
  lastError: null,
  cursor: null,
  ...overrides,
});

/**
 * A recipe in exactly the shape `firestore.rules` requires on create:
 * name, ingredients, instructions, source, createdAt, tags, servings,
 * difficulty, timesCooked.
 *
 * Separate from `makeRecipe` above, which predates that contract.
 */
export const makeHelloFreshRecipe = (overrides = {}) => ({
  id: nextId('hf-recipe'),
  name: 'Sweet Chili Chicken',
  ingredients: [
    { name: 'Chicken Breast', quantity: 2, unit: 'unit', normalized: 'chicken breast' },
    { name: 'Tomato Paste', quantity: 28, unit: 'g', normalized: 'tomato paste' },
  ],
  instructions: ['Preheat the oven to 425F.', 'Roast the chicken for 20 minutes.'],
  source: 'hellofresh',
  createdAt: daysFromNow(-2),
  tags: ['hellofresh', 'chicken'],
  prepTime: 10,
  cookTime: 25,
  servings: 2,
  difficulty: 'medium',
  timesCooked: 0,
  imageUrl: null,
  sourceUrl: 'https://www.hellofresh.com/recipes/sweet-chili-chicken-123',
  ...overrides,
});

// ---------------------------------------------------------------------------
// users/{userId}/deliveries/{deliveryId}
// ---------------------------------------------------------------------------
export const makeDelivery = (overrides = {}) => ({
  id: nextId('delivery'),
  deliveredAt: daysFromNow(-1),
  weekOf: '2026-08-10',
  recipeIds: ['hf-recipe-1', 'hf-recipe-2', 'hf-recipe-3'],
  recipeNames: ['Sweet Chili Chicken', 'Sheet Pan Salmon', 'Veggie Tacos'],
  mealCount: 3,
  itemsAdded: 12,
  locationId: 'loc-fridge',
  status: 'received',
  source: 'hellofresh',
  notes: '',
  createdAt: daysFromNow(-1),
  ...overrides,
});

// ---------------------------------------------------------------------------
// users/{userId}/mealPlanEntries/{entryId}
//
// One scheduled meal. HelloFresh auto-scheduling and the waste-prevention
// "Add to Meal Plan" button write this same shape — only `source` differs.
// ---------------------------------------------------------------------------

/** A `YYYY-MM-DD` day key `n` days from today — the format meal plans use. */
export const dayKey = (n = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toDayKey(d);
};

/** `YYYY-MM-DD` for a Date, in local time (never UTC-shifted). */
export const toDayKey = (date) => {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const makeMealPlanEntry = (overrides = {}) => {
  const recipeName = overrides.recipeName ?? 'Sheet Pan Salmon';
  return {
    id: nextId('entry'),
    date: dayKey(0),
    mealType: 'dinner',
    recipeId: 'recipe-1',
    recipeName,
    servings: 2,
    status: 'planned',
    source: 'manual',
    createdAt: daysFromNow(-1),
    cookedAt: null,
    usesIngredients: [{ name: 'salmon', normalized: 'salmon', quantity: 2, unit: 'fillet' }],
    batchGroup: null,
    notes: '',
    planId: null,
    ...overrides,
  };
};

/** A week's worth of dinners, one per day, starting today. */
export const makeWeekOfEntries = () =>
  Array.from({ length: 7 }, (_, i) =>
    makeMealPlanEntry({ date: dayKey(i), recipeName: `Dinner ${i + 1}` })
  );

// ---------------------------------------------------------------------------
// users/{userId}/mealPlans/{weekId}
// ---------------------------------------------------------------------------
export const makeMealPlan = (overrides = {}) => ({
  id: dayKey(0),
  weekStart: dayKey(0),
  createdAt: daysFromNow(-1),
  source: 'ai',
  status: 'active',
  generatedAt: daysFromNow(-1),
  model: 'claude-opus-5',
  degraded: false,
  shoppingList: [
    { name: 'salmon', normalized: 'salmon', quantity: 2, unit: 'fillet', haveInInventory: false },
  ],
  batchCooking: [],
  notes: '',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Firestore snapshot shims
// ---------------------------------------------------------------------------

/**
 * Turn factory objects into the `{ id, data() }` shape `onSnapshot` yields,
 * so a test can hand a list straight to `__emit`.
 */
export const asDocs = (records) =>
  records.map(({ id, ...data }) => ({
    id,
    exists: () => true,
    data: () => data,
    ref: { __path: id, id },
  }));
