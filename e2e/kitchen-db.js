// e2e/kitchen-db.js
// Reads and writes the local Supabase stack's kitchen.docs directly from the
// test process (as the service role, through e2e/supabase-admin.js).
//
// Used to confirm that a write the UI made actually landed in the database.
// The UI renders its own writes optimistically, so "the item is on screen" does
// not prove it was accepted: a write that row-level security refuses looks
// identical until you read it back from somewhere else.
//
// Every helper works in the kitchen of the account this worker signs in as.
// Paths are the ones the screens use (users/<uid>/inventory/...); the
// household's collections are stored without the users/<uid>/ part, exactly as
// src/backend/docModel.js stores them.

const { currentAccount } = require('./accounts');
const {
  Timestamp,
  autoId,
  userIdFor,
  householdOf,
  putDoc,
  getDoc,
  listDocs,
  deleteDoc,
} = require('./supabase-admin');

let cached = null;

/**
 * The account this worker signs in as: { uid, hid }.
 *
 * `currentAccount()` reads TEST_PARALLEL_INDEX, which Playwright sets in each
 * worker process, so this resolves to the same account the browser is signed
 * in to. Cached per process, which is per worker, so the cache can never be
 * wrong.
 */
const me = async () => {
  if (!cached) {
    const { email } = currentAccount();
    const uid = await userIdFor(email);
    if (!uid) throw new Error(`No account for ${email}: did e2e/global-setup.js run?`);
    const hid = await householdOf(uid);
    if (!hid) throw new Error(`${email} has no household: did e2e/global-setup.js run?`);
    cached = { uid, hid };
  }
  return cached;
};

/** UID of the account this worker signs in as. */
const testUserId = async () => (await me()).uid;

/** Household of the account this worker signs in as. */
const testHouseholdId = async () => (await me()).hid;

/** Every document in one of my collections ('inventory', 'deliveries', ...). */
const mine = async (collection) => {
  const { uid, hid } = await me();
  return listDocs(hid, `users/${uid}/${collection}`);
};

/** One of my documents by id, or undefined. */
const mineById = async (collection, id) => {
  const { uid, hid } = await me();
  return getDoc(hid, `users/${uid}/${collection}/${id}`);
};

/** Writes a new document into one of my collections; returns its id. */
const addMine = async (collection, data) => {
  const { uid, hid } = await me();
  const id = autoId();
  await putDoc(hid, `users/${uid}/${collection}/${id}`, data);
  return id;
};

/** Deletes one of my documents. */
const deleteMine = async (collection, id) => {
  const { uid, hid } = await me();
  await deleteDoc(hid, `users/${uid}/${collection}/${id}`);
};

/** My profile document (users/<uid>), or undefined. */
const userProfile = async () => {
  const { uid, hid } = await me();
  return getDoc(hid, `users/${uid}`);
};

/** Every inventory document belonging to the seeded account. */
const inventoryItems = () => mine('inventory');

/** Does an item with this exact name exist in my kitchen? */
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
const importHistoryRecords = () => mine('importHistory');

/** Every delivery logged by the seeded account. */
const deliveries = () => mine('deliveries');

/**
 * Log a delivery straight in the database, bypassing the import.
 *
 * Field for field with addDelivery in src/hooks/useDeliveries.js, so it fails
 * loudly if the contract moves. For specs that start from a delivery already in the history rather
 * than importing a recipe first to make one.
 */
const seedDelivery = ({
  recipeNames = [],
  deliveredAt = new Date(),
  weekOf = '',
  status = 'received',
  mealCount = 1,
  itemsAdded = 2,
  notes = '',
} = {}) => {
  return addMine('deliveries', {
    deliveredAt: Timestamp.fromDate(deliveredAt),
    weekOf,
    recipeIds: [],
    recipeNames,
    mealCount,
    itemsAdded,
    locationId: 'loc-fridge',
    status,
    source: 'hellofresh',
    notes,
    createdAt: Timestamp.now(),
  });
};

/** The stored delivery document by id, or undefined. */
const deliveryById = (id) => mineById('deliveries', id);

/** Every recipe in my household's recipe book. */
const recipes = async () => {
  const { hid } = await me();
  return listDocs(hid, 'recipes');
};

/** Recipes imported from HelloFresh. */
const hellofreshRecipes = async () => (await recipes()).filter((r) => r.source === 'hellofresh');

/** How many recipes are in my household's recipe book right now. */
const recipeCount = async () => (await recipes()).length;

/**
 * Add an inventory item straight to the database, bypassing the UI.
 *
 * `expiresAt` defaults to now; `fields` overrides anything else (unit,
 * location, shelfLifeSource...).
 */
const seedInventoryItem = async ({
  name,
  quantity = 3,
  unit = 'ea',
  expiresAt = new Date(),
  ...fields
}) =>
  addMine('inventory', {
    name,
    normalized: name.toLowerCase(),
    quantity,
    unit,
    locationId: 'loc-fridge',
    locationType: 'fridge',
    addedAt: Timestamp.now(),
    expiresAt: Timestamp.fromDate(expiresAt),
    shelfLifeDays: 7,
    notes: '',
    source: 'seed',
    purchaseHistory: [],
    totalTimesPurchased: 1,
    ...fields,
  });

/** The stored inventory document by id, or undefined. */
const inventoryItemById = (id) => mineById('inventory', id);

/** Every meal plan entry belonging to the seeded account. */
const mealPlanEntries = () => mine('mealPlanEntries');

/** The stored meal plan entry with this recipe name, or undefined. */
const mealPlanEntry = async (recipeName) => {
  const entries = await mealPlanEntries();
  return entries.find((entry) => entry.recipeName === recipeName);
};

/** Schedule a meal straight in the database, for specs that start from one. */
const seedMealPlanEntry = ({
  date,
  recipeName,
  recipeId = null,
  mealType = 'dinner',
  servings = 2,
  source = 'manual',
  usesIngredients = [],
}) =>
  addMine('mealPlanEntries', {
    date,
    mealType,
    recipeId,
    recipeName,
    servings,
    status: 'planned',
    source,
    createdAt: Timestamp.now(),
    cookedAt: null,
    usesIngredients,
    batchGroup: null,
    notes: '',
    planId: null,
  });

/** Take a seeded meal off the plan again, so the next spec's week is clean. */
const deleteMealPlanEntry = (id) => deleteMine('mealPlanEntries', id);

/**
 * Every manual shopping item belonging to the seeded account.
 *
 * The rest of the shopping list is derived from the week's meals and the
 * kitchen, and has no documents at all — so there is nothing to read back for
 * those, and nothing that could be read back if a tick tried to store one.
 */
const shoppingItems = () => mine('shoppingItems');

/** The stored shopping item with this exact name, or undefined. */
const shoppingItem = async (name) => (await shoppingItems()).find((item) => item.name === name);

/**
 * Put an item straight on the shopping list, bypassing the UI.
 *
 * Field for field with buildShoppingItem in src/hooks/useShoppingList.js, so it fails loudly if the
 * contract moves. For specs that need a list already long enough to test what a
 * long list does.
 */
const seedShoppingItem = ({ name, quantity = 1, unit = '', status = 'pending' }) =>
  addMine('shoppingItems', {
    name,
    normalized: name.trim().toLowerCase(),
    quantity,
    unit,
    notes: '',
    status,
    source: 'manual',
    createdAt: Timestamp.now(),
    boughtAt: null,
  });

/** Take a seeded item off again, so the next spec's board is predictable. */
const deleteShoppingItem = (id) => deleteMine('shoppingItems', id);

/** Does a recipe with this exact name exist in my recipe book? */
const recipesHaveRecipe = async (name) => (await recipes()).some((r) => r.name === name);

/** The stored document for a recipe, or undefined. */
const recipeByName = async (name) => (await recipes()).find((r) => r.name === name);

/**
 * Add a recipe to my household's recipe book, in the shape the app writes.
 *
 * Recipes belong to the household now (kitchen.docs, path recipes/<id>), so a
 * worker's recipes are its own; a unique name still keeps one spec's recipe
 * from matching another spec's assertion in the same worker.
 *
 * Pass `ingredients` when the spec needs the recipe to match specific stock
 * (the waste-alerts suggestions do); omit it and the recipe gets a filler
 * ingredient, which is all the dashboard count cares about.
 */
const seedRecipe = async ({ name, ingredients = [], servings = 2, difficulty = 'easy' }) => {
  const { hid } = await me();
  const id = autoId();
  await putDoc(hid, `recipes/${id}`, {
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
    createdAt: Timestamp.now(),
  });
  return id;
};

/** Remove a recipe again, so a parallel spec's library stays predictable. */
const deleteRecipe = async (id) => deleteDoc((await me()).hid, `recipes/${id}`);

/** Every week document (mealPlans/<weekStart>) in my kitchen. */
const mealPlanWeeks = () => mine('mealPlans');

/** The stored week document for `weekStart`, or undefined. */
const mealPlanWeek = (weekStart) => mineById('mealPlans', weekStart);

module.exports = {
  mealPlanWeek,
  mealPlanWeeks,
  testUserId,
  testHouseholdId,
  userProfile,
  Timestamp,
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
  deleteMealPlanEntry,
  deliveries,
  seedDelivery,
  deliveryById,
  shoppingItems,
  shoppingItem,
  seedShoppingItem,
  deleteShoppingItem,
  hellofreshRecipes,
  recipeCount,
  recipes,
  recipesHaveRecipe,
  recipeByName,
  seedRecipe,
  deleteRecipe,
};
