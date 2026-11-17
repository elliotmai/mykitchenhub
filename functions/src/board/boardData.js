// functions/src/board/boardData.js
// What the `board` API returns, assembled from one cook's documents.
//
// The pure functions take plain documents and a clock, so the tests can pin
// the exact payload without Firestore; `loadBoardSources` is the only part that
// reads. Every read is under users/{uid} for the one uid the token resolved to,
// plus the shared `recipes` library — the admin SDK bypasses security rules, so
// that scoping is done here, in code, and nowhere else.

const {
  amountLabel,
  buildShoppingList,
  combineShoppingList,
  isUpcoming,
  normalizeName,
} = require('./shoppingList');
const { groupByStoreSection } = require('./storeSections');
const { ingredientAlternatives, ingredientKey, measureKey } = require('./ingredientMeasure');
const { toRecipeCard } = require('./recipeCards');
const { localDay, daysUntil, shiftDayKey, startOfWeekKey, toDate } = require('./dates');

/** How far ahead the board lists meals: today and the six days after it. */
const MEAL_DAYS = 7;

/** Same window as DEFAULT_ALERT_WINDOW_DAYS in src/hooks/useWasteAlerts.js. */
const EXPIRING_WITHIN_DAYS = 5;

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_ORDER = Object.fromEntries(MEAL_TYPES.map((type, index) => [type, index]));

const capitalize = (value) => {
  const text = String(value ?? '').trim();
  return text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : text;
};

/** The date range each part of the board covers, for a given "today". */
const boardWindow = (today) => {
  const weekStart = startOfWeekKey(today);
  return {
    today,
    mealsFrom: today,
    mealsTo: shiftDayKey(today, MEAL_DAYS - 1),
    // The shopping list is the app's: the Monday-to-Sunday week the meal plan
    // page opens on. That is what KitchenHub derives the list from, so it is
    // what this derives it from too, even though the meals above roll forward.
    weekStart,
    weekEnd: shiftDayKey(weekStart, 6),
  };
};

// ---------------------------------------------------------------------------
// Meals and recipes
// ---------------------------------------------------------------------------

/** Meal plan entries in [from, to], ordered by day and then the way a day is eaten. */
const mealsBetween = (entries, from, to) =>
  entries
    .filter((entry) => typeof entry.date === 'string' && entry.date >= from && entry.date <= to)
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        a.entry.date.localeCompare(b.entry.date) ||
        (MEAL_ORDER[a.entry.mealType] ?? 9) - (MEAL_ORDER[b.entry.mealType] ?? 9) ||
        a.index - b.index
    )
    .map(({ entry }) => entry);

const toMeal = (entry) => ({
  date: entry.date,
  type: capitalize(entry.mealType),
  name: String(entry.recipeName ?? '').trim(),
  recipeId: entry.recipeId || null,
  status: entry.status || 'planned',
});

/** Cards for the recipes those meals reference; a deleted recipe is left out. */
const recipeCards = (meals, recipesById) => {
  const cards = {};
  meals.forEach((meal) => {
    if (!meal.recipeId || cards[meal.recipeId]) return;
    const recipe = recipesById[meal.recipeId];
    if (recipe) cards[meal.recipeId] = toRecipeCard(recipe, meal.name);
  });
  return cards;
};

// ---------------------------------------------------------------------------
// Expiring food
// ---------------------------------------------------------------------------

/**
 * Inventory going off within five days, soonest first — the list the Waste
 * Alerts page and the KitchenHub kiosk show (`isExpiringWithin` and
 * `byExpirySoonestFirst` in src/hooks/useInventory.js). As there, food already
 * past its date is included, with a negative `days`; it is the most urgent
 * thing in the fridge, not something to hide.
 *
 * Days are counted by calendar day in the cook's timezone, as the daily alert
 * counts them (functions/src/wasteAlerts/alertMessage.js).
 */
const expiringItems = (inventory, now, timeZone) =>
  inventory
    .map((item) => ({
      item,
      days: daysUntil(item.expiresAt, now, timeZone),
      at: toDate(item.expiresAt),
    }))
    .filter(({ days }) => days !== null && days <= EXPIRING_WITHIN_DAYS)
    .sort((a, b) => a.at - b.at)
    .map(({ item, days }) => ({ name: String(item.name ?? '').trim(), days }));

// ---------------------------------------------------------------------------
// Shopping
// ---------------------------------------------------------------------------

/** The API id of a derived line: stable for as long as the week needs it. */
const derivedId = (row) => {
  const unit = normalizeName(row.unit);
  return unit ? `meal:${row.normalized}|${unit}` : `meal:${row.normalized}`;
};

const manualId = (item) => `item:${item.id}`;

/** Which of the week's meals a derived line is for, by recipe name. */
const mealsNeeding = (row, weekEntries) => {
  const measure = row.measure ?? measureKey(row.unit);
  const names = [];
  weekEntries.filter(isUpcoming).forEach((entry) => {
    // Matched the way buildShoppingList merged them: by ingredient key and kind
    // of measure, including an "or" ingredient that was folded into this line.
    const uses = (entry.usesIngredients || []).some((ingredient) => {
      if (measureKey(ingredient.unit) !== measure) return false;
      const key = ingredientKey(ingredient.normalized || ingredient.name);
      return key === row.normalized || ingredientAlternatives(key).includes(row.normalized);
    });
    const name = String(entry.recipeName ?? '').trim();
    if (uses && name && !names.includes(name)) names.push(name);
  });
  return names.length ? names.join(', ') : null;
};

/** Rows grouped into aisles, in the order a shop is walked, then flattened. */
const inAisleOrder = (rows) =>
  groupByStoreSection(rows).flatMap((aisle) =>
    aisle.items.map((row) => ({
      id: row.id,
      name: row.name,
      qty: row.qty,
      section: aisle.label,
      why: row.why,
      bought: row.bought,
    }))
  );

const wasBoughtOn = (item, today, timeZone) => {
  const at = toDate(item.boughtAt);
  return Boolean(at) && localDay(at, timeZone) === today;
};

/**
 * The list as KitchenHub's own kiosk shows it — `combineShoppingList` over the
 * typed items and `buildShoppingList(weekEntries, inventory)` — in aisle order,
 * followed by anything typed in and ticked off today, so the board can show
 * the cart.
 *
 * @returns {Array<{id, name, qty, section, why, bought}>}
 */
const shoppingRows = ({
  manualItems = [],
  weekEntries = [],
  inventory = [],
  boughtKeys = [],
  today,
  timeZone,
}) => {
  const derived = buildShoppingList(weekEntries, inventory, boughtKeys);
  const combined = combineShoppingList(manualItems, derived);

  const outstanding = combined.map((row) =>
    row.kind === 'manual'
      ? {
          id: manualId(row.item),
          name: row.name,
          qty: row.amount ?? '',
          why: null,
          bought: false,
          normalized: row.item.normalized || row.item.name,
        }
      : {
          id: derivedId(row.source),
          name: row.name,
          qty: row.amount ?? '',
          why: mealsNeeding(row.source, weekEntries),
          bought: false,
          normalized: row.source.normalized,
        }
  );

  const boughtToday = manualItems
    .filter((item) => item.status === 'bought' && wasBoughtOn(item, today, timeZone))
    .map((item) => ({
      id: manualId(item),
      name: item.name,
      qty: amountLabel(item) ?? '',
      why: null,
      bought: true,
      normalized: item.normalized || item.name,
    }));

  // Meal lines ticked off this week, so the board can show them in the cart
  // and put one back. They have no timestamp, so "today" is "this week".
  const boughtFromMeals = derived
    .filter((item) => item.bought && item.haveInInventory !== true)
    .map((item) => ({
      id: derivedId(item),
      name: item.name,
      qty: amountLabel(item) ?? '',
      why: mealsNeeding(item, weekEntries),
      bought: true,
      normalized: item.normalized,
    }));

  return [...inAisleOrder(outstanding), ...inAisleOrder([...boughtToday, ...boughtFromMeals])];
};

/** One typed item in the API's shape, e.g. straight after it is added. */
const manualRow = (item) => shoppingRows({ manualItems: [{ ...item, status: 'pending' }] })[0];

// ---------------------------------------------------------------------------
// The whole board
// ---------------------------------------------------------------------------

/**
 * @param {object} sources  { entries, inventory, manualItems, recipesById }
 * @param {object} clock    { now: Date, timeZone: string }
 */
const buildBoard = (
  { entries = [], inventory = [], manualItems = [], boughtKeys = [], recipesById = {} },
  { now, timeZone }
) => {
  const window = boardWindow(localDay(now, timeZone));
  const mealEntries = mealsBetween(entries, window.mealsFrom, window.mealsTo);
  const meals = mealEntries.map(toMeal);
  const weekEntries = entries.filter(
    (entry) => entry.date >= window.weekStart && entry.date <= window.weekEnd
  );

  return {
    today: window.today,
    meals,
    recipes: recipeCards(meals, recipesById),
    expiring: expiringItems(inventory, now, timeZone),
    shopping: shoppingRows({
      manualItems,
      weekEntries,
      inventory,
      boughtKeys,
      today: window.today,
      timeZone,
    }),
  };
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const docsOf = (snapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

/**
 * Everything the board is built from, for one uid.
 *
 * One meal plan query covers both the shopping week and the seven days of
 * meals: it starts on the week's Monday, which is never after today, and ends
 * at today + 6, which is never before the week's Sunday. A range and an
 * orderBy on the same field need no composite index.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 * @param {string} today  `YYYY-MM-DD` in the cook's timezone
 * @param {{recipes?: boolean}} [options]  recipes: false skips the recipe reads
 */
const loadBoardSources = async (db, uid, today, { recipes = true } = {}) => {
  const window = boardWindow(today);
  const user = db.collection('users').doc(uid);

  const [entrySnap, inventorySnap, shoppingSnap, planSnap] = await Promise.all([
    user
      .collection('mealPlanEntries')
      .where('date', '>=', window.weekStart)
      .where('date', '<=', window.mealsTo)
      .orderBy('date', 'asc')
      .get(),
    user.collection('inventory').orderBy('name', 'asc').get(),
    user.collection('shoppingItems').orderBy('createdAt', 'desc').get(),
    // The week's document holds which derived lines were ticked off.
    user.collection('mealPlans').doc(window.weekStart).get(),
  ]);

  const entries = docsOf(entrySnap);
  const recipesById = {};

  if (recipes) {
    const ids = [
      ...new Set(
        mealsBetween(entries, window.mealsFrom, window.mealsTo)
          .map((entry) => entry.recipeId)
          .filter((id) => typeof id === 'string' && id && !id.includes('/'))
      ),
    ];
    if (ids.length) {
      const snaps = await db.getAll(...ids.map((id) => db.collection('recipes').doc(id)));
      snaps.forEach((snap) => {
        if (snap.exists) recipesById[snap.id] = snap.data();
      });
    }
  }

  return {
    entries,
    inventory: docsOf(inventorySnap),
    manualItems: docsOf(shoppingSnap),
    boughtKeys: (planSnap?.exists && planSnap.data()?.boughtKeys) || [],
    recipesById,
  };
};

module.exports = {
  MEAL_DAYS,
  EXPIRING_WITHIN_DAYS,
  boardWindow,
  mealsBetween,
  toMeal,
  recipeCards,
  expiringItems,
  derivedId,
  manualId,
  mealsNeeding,
  shoppingRows,
  manualRow,
  buildBoard,
  loadBoardSources,
};
