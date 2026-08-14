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

/** Recompute the shopping list rather than trusting the model's arithmetic. */
function deriveShoppingList(entries, inventory = []) {
  const stock = new Map();
  inventory.forEach((item) => {
    const key = normalize(item.normalized || item.name);
    stock.set(key, (stock.get(key) ?? 0) + (Number(item.quantity) || 0));
  });

  const needed = new Map();
  entries.forEach((entry) => {
    entry.usesIngredients.forEach((ingredient) => {
      const existing = needed.get(ingredient.normalized);
      if (existing) existing.quantity += ingredient.quantity;
      else
        needed.set(ingredient.normalized, {
          name: ingredient.name || ingredient.normalized,
          normalized: ingredient.normalized,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
        });
    });
  });

  return [...needed.values()]
    .map((item) => {
      const onHand = stock.get(item.normalized) ?? 0;
      return {
        ...item,
        quantity: Math.round(item.quantity * 100) / 100,
        haveInInventory: item.quantity > 0 && onHand >= item.quantity,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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

      const recipeId = knownRecipes.has(entry?.recipeId) ? entry.recipeId : null;
      const ingredients = cleanIngredients(entry?.usesIngredients);
      const fallbackIngredients = recipeId ? knownRecipes.get(recipeId).ingredients : [];

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
