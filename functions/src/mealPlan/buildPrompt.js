// functions/src/mealPlan/buildPrompt.js
// The prompt behind "Generate plan" — roadmap 7.2 and 7.3.
//
// Everything the model is asked to weigh comes from the kitchen: what is about
// to expire, what the household will and won't eat, which nights HelloFresh
// already owns, and which recipes are actually available to cook.

const { EXPIRING_WITHIN_DAYS } = require('./planContext');

const SYSTEM_PROMPT = `You plan a household's week of home cooking.

Priorities, in order:
1. Cook the ingredients that expire soonest before they are wasted.
2. Respect every dietary restriction and allergy without exception.
3. Avoid disliked ingredients unless there is no alternative.
4. Prefer recipes from the household's own library; only invent a simple meal when nothing in the library fits, and set recipeId to "" when you do.
5. Group meals that share prep or oven time into the same batchGroup so they can be cooked in one session.

Rules:
- Plan exactly one dinner for each open day you are given. Never schedule anything on a day listed as already taken.
- Use the day keys exactly as given, in YYYY-MM-DD form.
- When you use a library recipe, copy its id into recipeId and its ingredients into usesIngredients so the kitchen's inventory can be decremented when the meal is cooked.
- batchGroup is a short lowercase slug shared by the meals cooked together, or "" for a meal cooked on its own. Only group meals on different days — cooking two meals on the same day saves nothing.
- Every batchCooking entry explains, in one sentence a cook can act on, what to do once instead of twice.
- shoppingList is what the household still needs to buy: the planned ingredients minus what the inventory already covers.`;

const listOrNone = (values, none) =>
  values && values.length ? values.join(', ') : none;

const formatExpiring = (expiring) => {
  if (!expiring.length) return 'Nothing is close to expiring.';
  return expiring
    .map((item) => {
      const when =
        item.daysUntilExpiry < 0
          ? `expired ${Math.abs(item.daysUntilExpiry)} days ago`
          : item.daysUntilExpiry === 0
            ? 'expires today'
            : `expires in ${item.daysUntilExpiry} days`;
      return `- ${item.name} (${item.quantity} ${item.unit}, ${when})`;
    })
    .join('\n');
};

const formatInventory = (inventory) => {
  if (!inventory.length) return 'The kitchen is empty.';
  return inventory.map((item) => `- ${item.name}: ${item.quantity} ${item.unit}`).join('\n');
};

const formatRecipes = (recipes) => {
  if (!recipes.length) return 'The household has no saved recipes — invent simple meals.';
  return recipes
    .map((recipe) => {
      const ingredients = recipe.ingredients
        .map((i) => `${i.name} ${i.quantity}${i.unit ? ` ${i.unit}` : ''}`)
        .join('; ');
      const time = [recipe.prepTime, recipe.cookTime].filter(Boolean).join(' + ');
      return `- ${recipe.id} | ${recipe.name} | serves ${recipe.servings}${
        time ? ` | ${time} min` : ''
      } | ${recipe.difficulty} | ${ingredients || 'no ingredients listed'}`;
    })
    .join('\n');
};

const formatHelloFresh = (helloFresh, takenDays) => {
  if (!helloFresh.active) return 'No HelloFresh deliveries this week.';
  const lines = [`HelloFresh is active with ${helloFresh.mealsPerWeek || 'some'} meals per week.`];
  if (takenDays.length) {
    lines.push(`Delivered meals already fill these days: ${takenDays.join(', ')}.`);
  }
  if (helloFresh.deliveryDayKeys.length) {
    lines.push(`Deliveries land on: ${helloFresh.deliveryDayKeys.join(', ')}.`);
  }
  return lines.join(' ');
};

/**
 * Build the system and user prompts from a planning context.
 *
 * @param {object} context - from collectPlanContext()
 * @returns {{ system: string, user: string }}
 */
function buildPrompt(context) {
  const { preferences } = context;

  const user = `Plan dinners for the week starting ${context.weekStart}.

DAYS TO FILL (one dinner each): ${context.openDays.join(', ') || 'none'}
DAYS ALREADY TAKEN (do not plan anything here): ${listOrNone(context.takenDays, 'none')}

HOUSEHOLD
- Servings per meal: ${preferences.defaultServings}
- Dietary restrictions: ${listOrNone(preferences.dietaryRestrictions, 'none')}
- Allergies: ${listOrNone(preferences.allergies, 'none')}
- Dislikes: ${listOrNone(preferences.dislikedIngredients, 'none')}

${formatHelloFresh(context.helloFresh, context.takenDays)}

EXPIRING WITHIN ${EXPIRING_WITHIN_DAYS} DAYS (use these first)
${formatExpiring(context.expiring)}

EVERYTHING IN THE KITCHEN
${formatInventory(context.inventory)}

RECIPE LIBRARY (id | name | servings | time | difficulty | ingredients)
${formatRecipes(context.recipes)}

Return the plan as JSON matching the required schema.`;

  return { system: SYSTEM_PROMPT, user };
}

module.exports = { buildPrompt, SYSTEM_PROMPT };
