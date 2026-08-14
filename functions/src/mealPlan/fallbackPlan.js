// functions/src/mealPlan/fallbackPlan.js
// The plan a cook still gets when Claude is unreachable — roadmap 7.2.
//
// No API key configured, or the call failed: rather than an error page, this
// builds a week from the same priority the AI is asked to follow — cook what is
// about to go off, in the order it goes off — using only the recipe library.

const { normalize } = require('./planContext');
const { deriveShoppingList } = require('./parsePlan');

/** Does this recipe break a restriction, allergy, or dislike? */
function isExcluded(recipe, preferences) {
  const banned = [
    ...(preferences.dietaryRestrictions || []),
    ...(preferences.allergies || []),
    ...(preferences.dislikedIngredients || []),
  ]
    .map(normalize)
    .filter(Boolean);

  if (!banned.length) return false;

  const haystack = [
    ...recipe.ingredients.map((i) => i.normalized),
    ...(recipe.tags || []).map(normalize),
    normalize(recipe.name),
  ];

  return banned.some((term) => haystack.some((value) => value.includes(term)));
}

/**
 * How useful is this recipe this week?
 *
 * Ingredients expiring sooner are worth more; anything already in the kitchen
 * counts for a little, since it saves a shop.
 */
function scoreRecipe(recipe, expiring, inventory) {
  const urgency = new Map(
    expiring.map((item) => [item.normalized, Math.max(1, 8 - (item.daysUntilExpiry ?? 7))])
  );
  const stocked = new Set(inventory.map((item) => item.normalized));

  return recipe.ingredients.reduce((score, ingredient) => {
    if (urgency.has(ingredient.normalized)) return score + urgency.get(ingredient.normalized);
    if (stocked.has(ingredient.normalized)) return score + 0.5;
    return score;
  }, 0);
}

/** Suggest cooking sessions for meals on different days sharing an ingredient. */
function deriveBatchCooking(entries) {
  const byIngredient = new Map();
  entries.forEach((entry) => {
    entry.usesIngredients.forEach((ingredient) => {
      if (!byIngredient.has(ingredient.normalized)) {
        byIngredient.set(ingredient.normalized, { name: ingredient.name, entries: [] });
      }
      byIngredient.get(ingredient.normalized).entries.push(entry);
    });
  });

  const tips = [];
  byIngredient.forEach(({ name, entries: members }, key) => {
    const dates = [...new Set(members.map((m) => m.date))].sort();
    if (dates.length < 2) return;
    // With a short recipe library the same meal lands on several days; "prep
    // onion once, it's used in Curry and Curry" is not a tip worth reading.
    if (new Set(members.map((m) => m.recipeName)).size < 2) return;
    tips.push({
      group: key,
      title: `Prep ${name} once`,
      detail: `${name} is used in ${members
        .map((m) => m.recipeName)
        .join(' and ')}. Do all the chopping on ${dates[0]} and the later meal comes together fast.`,
      entryDates: dates,
    });
  });

  return tips.slice(0, 3);
}

/**
 * Build a week without calling the API.
 *
 * @param {object} context - from collectPlanContext()
 * @returns {{ entries, shoppingList, batchCooking, notes }|null}
 */
function buildFallbackPlan(context) {
  const { openDays, expiring, inventory, preferences, recipes } = context;
  if (!openDays.length) return null;

  const servings = preferences.defaultServings || 2;

  const candidates = recipes
    .filter((recipe) => !isExcluded(recipe, preferences))
    .map((recipe) => ({ recipe, score: scoreRecipe(recipe, expiring, inventory) }))
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name));

  const entries = openDays.map((date, index) => {
    const candidate = candidates[index % Math.max(candidates.length, 1)];

    if (!candidate) {
      // No usable recipes at all — still give the cook a nudge toward the
      // ingredient that is about to be thrown away.
      const urgent = expiring[index % Math.max(expiring.length, 1)];
      return {
        date,
        mealType: 'dinner',
        recipeId: null,
        recipeName: urgent ? `Use up the ${urgent.name}` : 'Cook something simple',
        servings,
        usesIngredients: urgent
          ? [
              {
                name: urgent.name,
                normalized: urgent.normalized,
                quantity: 1,
                unit: urgent.unit || '',
              },
            ]
          : [],
        batchGroup: null,
        notes: 'Added without the AI planner.',
      };
    }

    return {
      date,
      mealType: 'dinner',
      recipeId: candidate.recipe.id,
      recipeName: candidate.recipe.name,
      servings,
      usesIngredients: candidate.recipe.ingredients,
      batchGroup: null,
      notes: '',
    };
  });

  return {
    entries,
    shoppingList: deriveShoppingList(entries, inventory),
    batchCooking: deriveBatchCooking(entries),
    notes: 'Built from what is expiring in your kitchen.',
  };
}

module.exports = { buildFallbackPlan, scoreRecipe, isExcluded, deriveBatchCooking };
