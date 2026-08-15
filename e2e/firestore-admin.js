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
/** Every recipe in the shared library. */
const recipes = async () => {
  const snap = await admin.firestore().collection('recipes').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/** Does a recipe with this exact name exist in Firestore? */
const recipesHaveRecipe = async (name) => (await recipes()).some((r) => r.name === name);

/** The stored document for a recipe, or undefined. */
const recipeByName = async (name) => (await recipes()).find((r) => r.name === name);

/**
 * Add a recipe to the shared library, in the shape the schema documents.
 *
 * Field-for-field with the `create` rule in firestore.rules, so it fails loudly
 * if the contract moves.
 *
 * `recipes` is a global collection, so every spec that seeds one has to pick a
 * unique name — they run in parallel against one emulator.
 *
 * Pass `ingredients` when the spec needs the recipe to match specific stock
 * (the waste-alerts suggestions do); omit it and the recipe gets a filler
 * ingredient, which is all the dashboard count cares about.
 */
const seedRecipe = async ({ name, ingredients = [], servings = 2, difficulty = 'easy' }) => {
  const ref = await admin
    .firestore()
    .collection('recipes')
    .add({
      name,
      ingredients: ingredients.length
        ? ingredients.map((ingredient) => ({
            name: ingredient,
            normalized: ingredient.toLowerCase(),
            quantity: 1,
            unit: 'ea',
          }))
        : [{ name: 'rice', normalized: 'rice', quantity: 1, unit: 'cup' }],
      instructions: 'Cook it.',
      source: 'user-created',
      difficulty,
      servings,
      timesCooked: 0,
      tags: ['dinner'],
      createdAt: admin.firestore.Timestamp.now(),
    });
  return ref.id;
};

/** Remove a recipe again, so a parallel spec's library stays predictable. */
const deleteRecipe = async (id) => {
  await admin.firestore().doc(`recipes/${id}`).delete();
};

/** The stored week document for `weekStart`, or undefined. */
const mealPlanWeek = async (weekStart) => {
  const uid = await testUserId();
  const snap = await admin.firestore().doc(`users/${uid}/mealPlans/${weekStart}`).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : undefined;
};

module.exports = {
  mealPlanWeek,
  testUserId,
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
  recipes,
  recipesHaveRecipe,
  recipeByName,
  seedRecipe,
  deleteRecipe,
};
