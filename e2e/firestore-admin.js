// e2e/firestore-admin.js
// Reads the emulator's Firestore directly from the test process.
//
// Used to confirm that a write the UI made actually landed in the database.
// The UI renders its own writes optimistically, so "the item is on screen" does
// not prove it was accepted — a write that violates a security rule looks
// identical until you read it back from somewhere else.
//
// Reading back through a second browser page would be more end-to-end, but a
// service-worker-controlled navigation issued while a Firestore connection is
// settling never resolves for Playwright, so it hangs rather than fails.

const admin = require('firebase-admin');
const { TEST_USER } = require('./global-setup');

const PROJECT_ID = process.env.E2E_PROJECT_ID || 'mykitchenhub-e2e';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

let cachedUid = null;

/** UID of the seeded end-to-end account. */
const testUserId = async () => {
  if (!cachedUid) {
    cachedUid = (await admin.auth().getUserByEmail(TEST_USER.email)).uid;
  }
  return cachedUid;
};

/** Every inventory document belonging to the seeded account. */
const inventoryItems = async () => {
  const uid = await testUserId();
  const snap = await admin.firestore().collection(`users/${uid}/inventory`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/** Does an item with this exact name exist in Firestore? */
const inventoryHasItem = async (name) => {
  const items = await inventoryItems();
  return items.some((item) => item.name === name);
};

/** The stored document for an item, or undefined. */
const inventoryItem = async (name) => {
  const items = await inventoryItems();
  return items.find((item) => item.name === name);
};

/** Items whose name starts with `prefix` — bulk imports are named that way. */
const inventoryItemsNamed = async (prefix) => {
  const items = await inventoryItems();
  return items.filter((item) => String(item.name || '').startsWith(prefix));
};

/** Every bulk-import record belonging to the seeded account. */
const importHistoryRecords = async () => {
  const uid = await testUserId();
  const snap = await admin.firestore().collection(`users/${uid}/importHistory`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/** Every delivery logged by the seeded account. */
const deliveries = async () => {
  const uid = await testUserId();
  const snap = await admin.firestore().collection(`users/${uid}/deliveries`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/** Recipes imported from HelloFresh — the shared library, not a subcollection. */
const hellofreshRecipes = async () => {
  const snap = await admin
    .firestore()
    .collection('recipes')
    .where('source', '==', 'hellofresh')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/** How many recipes are in the shared library right now. */
const recipeCount = async () => {
  const snap = await admin.firestore().collection('recipes').get();
  return snap.size;
};

/** Add an inventory item straight to the emulator, bypassing the UI. */
const seedInventoryItem = async ({ name, quantity = 3, unit = 'ea' }) => {
  const uid = await testUserId();
  const ref = await admin.firestore().collection(`users/${uid}/inventory`).add({
    name,
    normalized: name.toLowerCase(),
    quantity,
    unit,
    locationId: 'loc-fridge',
    locationType: 'fridge',
    addedAt: admin.firestore.Timestamp.now(),
    expiresAt: admin.firestore.Timestamp.now(),
    shelfLifeDays: 7,
    notes: '',
    source: 'seed',
    purchaseHistory: [],
    totalTimesPurchased: 1,
  });
  return ref.id;
};

/** The stored inventory document by id, or undefined. */
const inventoryItemById = async (id) => {
  const uid = await testUserId();
  const snap = await admin.firestore().doc(`users/${uid}/inventory/${id}`).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : undefined;
};

/** Every meal plan entry belonging to the seeded account. */
const mealPlanEntries = async () => {
  const uid = await testUserId();
  const snap = await admin.firestore().collection(`users/${uid}/mealPlanEntries`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/** The stored meal plan entry with this recipe name, or undefined. */
const mealPlanEntry = async (recipeName) => {
  const entries = await mealPlanEntries();
  return entries.find((entry) => entry.recipeName === recipeName);
};

/** Schedule a meal straight in the emulator, for specs that start from one. */
const seedMealPlanEntry = async ({
  date,
  recipeName,
  mealType = 'dinner',
  servings = 2,
  source = 'manual',
  usesIngredients = [],
}) => {
  const uid = await testUserId();
  const ref = await admin.firestore().collection(`users/${uid}/mealPlanEntries`).add({
    date,
    mealType,
    recipeId: null,
    recipeName,
    servings,
    status: 'planned',
    source,
    createdAt: admin.firestore.Timestamp.now(),
    cookedAt: null,
    usesIngredients,
    batchGroup: null,
    notes: '',
    planId: null,
  });
  return ref.id;
};

/**
 * Add a recipe to the global library, in the shape the schema documents.
 *
 * Phase 4 has not shipped a recipe editor yet, so there is no real UI to drive
 * — this writes the documented contract instead, which is still enough to prove
 * the dashboard is counting the right collection. Field-for-field with the
 * `create` rule in firestore.rules, so it fails loudly if the contract moves.
 */
const seedRecipe = async ({ name, servings = 2, difficulty = 'easy' }) => {
  const ref = await admin
    .firestore()
    .collection('recipes')
    .add({
      name,
      ingredients: [{ name: 'rice', quantity: 1, unit: 'cup', normalized: 'rice' }],
      instructions: 'Cook it.',
      source: 'user-created',
      createdAt: admin.firestore.Timestamp.now(),
      tags: ['dinner'],
      servings,
      difficulty,
      timesCooked: 0,
    });
  return ref.id;
};

module.exports = {
  testUserId,
  seedRecipe,
  inventoryItems,
  inventoryHasItem,
  inventoryItem,
  inventoryItemsNamed,
  importHistoryRecords,
  inventoryItemById,
  seedInventoryItem,
  mealPlanEntries,
  mealPlanEntry,
  seedMealPlanEntry,
  deliveries,
  hellofreshRecipes,
  recipeCount,
};
