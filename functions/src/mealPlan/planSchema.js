// functions/src/mealPlan/planSchema.js
// The JSON shape the planner must return — roadmap 7.2.
//
// Passed to the Messages API as a structured output format, so the model is
// constrained to this schema rather than asked nicely to follow it. Structured
// outputs reject numeric/length constraints, so ranges are enforced in
// parsePlan.js instead.

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

const INGREDIENT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    normalized: { type: 'string' },
    quantity: { type: 'number' },
    unit: { type: 'string' },
  },
  required: ['name', 'normalized', 'quantity', 'unit'],
  additionalProperties: false,
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          mealType: { type: 'string', enum: MEAL_TYPES },
          // Empty string when the meal is not one of the supplied recipes.
          recipeId: { type: 'string' },
          recipeName: { type: 'string' },
          servings: { type: 'integer' },
          usesIngredients: { type: 'array', items: INGREDIENT_SCHEMA },
          // Shared slug for meals meant to be cooked in one session.
          batchGroup: { type: 'string' },
          notes: { type: 'string' },
        },
        required: [
          'date',
          'mealType',
          'recipeId',
          'recipeName',
          'servings',
          'usesIngredients',
          'batchGroup',
          'notes',
        ],
        additionalProperties: false,
      },
    },
    shoppingList: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          normalized: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          haveInInventory: { type: 'boolean' },
        },
        required: ['name', 'normalized', 'quantity', 'unit', 'haveInInventory'],
        additionalProperties: false,
      },
    },
    batchCooking: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          group: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          entryDates: { type: 'array', items: { type: 'string' } },
        },
        required: ['group', 'title', 'detail', 'entryDates'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['entries', 'shoppingList', 'batchCooking', 'notes'],
  additionalProperties: false,
};

module.exports = { PLAN_SCHEMA, MEAL_TYPES, INGREDIENT_SCHEMA };
