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
    smsAlerts: false,
    phoneNumber: null,
    alertTime: '09:00',
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
// recipes/{recipeId}
// ---------------------------------------------------------------------------
export const makeRecipe = (overrides = {}) => ({
  id: nextId('recipe'),
  title: 'Sheet Pan Salmon',
  source: 'manual',
  ingredients: [
    { name: 'salmon', quantity: 2, unit: 'fillet' },
    { name: 'spinach', quantity: 1, unit: 'bag' },
  ],
  instructions: ['Heat oven to 400F.', 'Roast 15 minutes.'],
  tags: ['dinner', 'quick'],
  prepTime: 10,
  cookTime: 15,
  servings: 2,
  imageUrl: null,
  timesCooked: 0,
  createdAt: daysFromNow(-10),
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
