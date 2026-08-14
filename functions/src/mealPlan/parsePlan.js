// functions/src/mealPlan/parsePlan.js
// Turn whatever the model returned into a plan the client can write — 7.2.
//
// Structured outputs constrain the shape, not the semantics: the model can
// still name a day outside the week, plan on a day HelloFresh owns, or ask for
// zero servings. Those entries are dropped here rather than failing a security
// rule at write time.

const { MEAL_TYPES } = require('./planSchema');
const { isDayKey, normalize } = require('./planContext');

/** Pull JSON out of a response, tolerating a code fence or surrounding prose. */
function extractJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;

  const withoutFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(withoutFence);
  } catch (err) {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch (innerErr) {
      return null;
    }
  }
}

const cleanIngredients = (ingredients) =>
  (Array.isArray(ingredients) ? ingredients : [])
    .map((ingredient) => ({
      name: String(ingredient?.name ?? '').trim(),
      normalized: normalize(ingredient?.normalized || ingredient?.name),
      quantity: Number(ingredient?.quantity) || 0,
      unit: String(ingredient?.unit ?? '').trim(),
    }))
    .filter((ingredient) => ingredient.normalized);

/**
 * Two quantities only add up when they are counted the same way.
 *
 * "2 cups flour" plus "200 g flour" is not "202 cups flour", so the list is
 * keyed on ingredient *and* unit. Mirrors buildShoppingList in
 * src/hooks/useMealPlan.js, which builds the same list from the client.
 */
const stockKey = (name, unit) => `${normalize(name)}|${normalize(unit)}`;

/**
 * Index the kitchen so a lookup can tell "a different measure" from
 * "no measure recorded".
 */
function indexStock(inventory) {
  const byNameAndUnit = new Map();
  const unitlessByName = new Map();
  const byName = new Map();

  inventory.forEach((item) => {
    const name = normalize(item.normalized || item.name);
    const quantity = Number(item.quantity) || 0;
    const add = (map, key) => map.set(key, (map.get(key) ?? 0) + quantity);

    add(byNameAndUnit, stockKey(name, item.unit));
    add(byName, name);
    if (!normalize(item.unit)) add(unitlessByName, name);
  });

  /**
   * How much of this ingredient the kitchen has, in the unit asked for.
   *
   * A jar measured in bags does not cover a recipe measured in grams. An item
   * stored with no unit at all is a different case — that is a gap in the
   * record, not a different substance, so it still counts.
   */
  return (name, unit) => {
    if (!normalize(unit)) return byName.get(normalize(name)) ?? 0;
    return (
      (byNameAndUnit.get(stockKey(name, unit)) ?? 0) + (unitlessByName.get(normalize(name)) ?? 0)
    );
  };
}

/** Recompute the shopping list rather than trusting the model's arithmetic. */
function deriveShoppingList(entries, inventory = []) {
  const onHandFor = indexStock(inventory);

  const needed = new Map();
  entries.forEach((entry) => {
    (entry.usesIngredients || []).forEach((ingredient) => {
      const key = stockKey(ingredient.normalized, ingredient.unit);
      const existing = needed.get(key);
      if (existing) existing.quantity += ingredient.quantity;
      else
        needed.set(key, {
          name: ingredient.name || ingredient.normalized,
          normalized: ingredient.normalized,
          quantity: ingredient.quantity,
          unit: ingredient.unit || '',
        });
    });
  });

  return [...needed.values()]
    .map((item) => {
      const onHand = onHandFor(item.normalized, item.unit);
      return {
        ...item,
        quantity: Math.round(item.quantity * 100) / 100,
        onHand,
        haveInInventory: item.quantity > 0 && onHand >= item.quantity,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
}

/**
 * Validate and normalise a generated plan.
 *
 * @param {object|string} raw       - parsed JSON or raw response text
 * @param {object}        context   - from collectPlanContext()
 * @returns {{ entries, shoppingList, batchCooking, notes }|null}
 */
function parsePlan(raw, context) {
  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.entries)) return null;

  const allowedDays = new Set(context.openDays);
  const knownRecipes = new Map(context.recipes.map((recipe) => [recipe.id, recipe]));
  const usedDays = new Set();

  const entries = parsed.entries
    .map((entry) => {
      const date = entry?.date;
      if (!isDayKey(date) || !allowedDays.has(date)) return null;

      const mealType = MEAL_TYPES.includes(entry?.mealType) ? entry.mealType : 'dinner';
      // One dinner per day; anything beyond that is the model double-booking.
      const slot = `${date}:${mealType}`;
      if (usedDays.has(slot)) return null;
      usedDays.add(slot);

      const recipeName = String(entry?.recipeName ?? '').trim();
      if (!recipeName) return null;

      // A named recipe the library does not have is the model inventing an id;
      // keep the meal, drop the dangling reference.
      const recipeId = knownRecipes.has(entry?.recipeId) ? entry.recipeId : null;
      const ingredients = cleanIngredients(entry?.usesIngredients);
      // A library recipe with no ingredient list yields undefined here, which
      // Firestore rejects on write — always hand back an array.
      const fallbackIngredients = (recipeId ? knownRecipes.get(recipeId).ingredients : null) || [];

      const servings = Math.max(
        1,
        Math.round(Number(entry?.servings) || context.preferences.defaultServings || 2)
      );

      const batchGroup = String(entry?.batchGroup ?? '').trim();

      return {
        date,
        mealType,
        recipeId,
        recipeName,
        servings,
        usesIngredients: ingredients.length ? ingredients : fallbackIngredients,
        batchGroup: batchGroup || null,
        notes: String(entry?.notes ?? '').trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!entries.length) return null;

  const plannedDates = new Set(entries.map((entry) => entry.date));
  const batchCooking = (Array.isArray(parsed.batchCooking) ? parsed.batchCooking : [])
    .map((tip) => ({
      group: String(tip?.group ?? '').trim(),
      title: String(tip?.title ?? '').trim(),
      detail: String(tip?.detail ?? '').trim(),
      entryDates: (Array.isArray(tip?.entryDates) ? tip.entryDates : []).filter((date) =>
        plannedDates.has(date)
      ),
    }))
    .filter((tip) => tip.group && tip.title && tip.entryDates.length >= 2);

  return {
    entries,
    shoppingList: deriveShoppingList(entries, context.inventory),
    batchCooking,
    notes: String(parsed.notes ?? '').trim(),
  };
}

module.exports = { parsePlan, extractJson, deriveShoppingList, cleanIngredients };
