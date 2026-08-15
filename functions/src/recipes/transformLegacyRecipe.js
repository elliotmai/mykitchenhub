// functions/src/recipes/transformLegacyRecipe.js
// Maps a "Let's Eat" recipe onto the shape firestore.rules requires.
//
// The legacy app stored very little: `name`, a loose `ingredients` array, and
// `tags`. Ingredients arrive either as objects or as free text ("1 cup milk"),
// so the parser below has to cope with both — and always emit `normalized`,
// which is what recipe/inventory matching keys on.

/** Units worth recognising in a free-text ingredient line. */
const UNITS = [
  'cups',
  'cup',
  'tablespoons',
  'tablespoon',
  'tbsp',
  'teaspoons',
  'teaspoon',
  'tsp',
  'pounds',
  'pound',
  'lbs',
  'lb',
  'ounces',
  'ounce',
  'oz',
  'grams',
  'gram',
  'kilograms',
  'kilogram',
  'kg',
  'g',
  'liters',
  'liter',
  'milliliters',
  'milliliter',
  'ml',
  'l',
  'gallons',
  'gallon',
  'quarts',
  'quart',
  'pints',
  'pint',
  'cloves',
  'clove',
  'slices',
  'slice',
  'pieces',
  'piece',
  'cans',
  'can',
  'bunches',
  'bunch',
];

/** Lowercased, whitespace-collapsed name — the inventory match key. */
const normalizeName = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** "1 1/2 cups flour" → { name: 'flour', quantity: 1.5, unit: 'cup' }. */
const parseIngredientString = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return { name: '', quantity: 1, unit: '' };

  let rest = text;
  let quantity = 1;

  // Leading amount: "2", "1.5", "1/2" or "1 1/2".
  const amount = rest.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*/);
  if (amount) {
    const value = amount[1].trim();
    if (/^\d+\s+\d+\/\d+$/.test(value)) {
      const [whole, fraction] = value.split(/\s+/);
      const [num, den] = fraction.split('/').map(Number);
      quantity = Number(whole) + num / den;
    } else if (value.includes('/')) {
      const [num, den] = value.split('/').map(Number);
      quantity = den ? num / den : 1;
    } else {
      quantity = Number(value);
    }
    rest = rest.slice(amount[0].length);
  }

  // Unit, only when it is the next word.
  let unit = '';
  const firstWord = rest.trim().split(/\s+/)[0]?.toLowerCase().replace(/[.,]/g, '') ?? '';
  if (UNITS.includes(firstWord)) {
    unit = firstWord.replace(/s$/, '');
    rest = rest.trim().slice(firstWord.length);
  }

  const name = rest
    .trim()
    .replace(/^(of|a|an|the)\s+/i, '')
    .replace(/^[,\-–]\s*/, '')
    .trim();

  return { name: name || text, quantity, unit };
};

/** Normalise whatever the legacy app stored into the documented ingredient shape. */
const parseIngredients = (ingredients) => {
  if (!Array.isArray(ingredients)) return [];

  return ingredients
    .map((ingredient) => {
      if (ingredient && typeof ingredient === 'object') {
        const name = String(ingredient.name ?? ingredient.item ?? '').trim();
        if (!name) return null;
        const quantity = parseFloat(ingredient.quantity ?? ingredient.amount);
        return {
          name,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          unit: String(ingredient.unit ?? '').trim(),
          normalized: normalizeName(name),
        };
      }

      if (typeof ingredient === 'string') {
        const parsed = parseIngredientString(ingredient);
        if (!parsed.name) return null;
        return { ...parsed, normalized: normalizeName(parsed.name) };
      }

      return null;
    })
    .filter(Boolean);
};

/** Instructions may arrive as an array, a blob of text, or nothing at all. */
const parseInstructions = (instructions) => {
  if (Array.isArray(instructions)) {
    return instructions.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof instructions === 'string') {
    return instructions
      .split(/\r?\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const DIFFICULTIES = ['easy', 'medium', 'hard'];

/**
 * Build a contract-valid `recipes` document from a legacy one.
 *
 * Every field firestore.rules requires on create is present, including the ones
 * the legacy app never had: `difficulty`, `servings`, `timesCooked`.
 *
 * @param {object} legacy    - the legacy document data
 * @param {string} legacyId  - its document id, kept for de-duplication
 * @param {object} options
 * @param {string} options.createdAt - ISO timestamp
 */
const transformLegacyRecipe = (legacy = {}, legacyId, { createdAt } = {}) => {
  const name = String(legacy.name ?? legacy.title ?? '').trim() || 'Untitled Recipe';
  const tags = (Array.isArray(legacy.tags) ? legacy.tags : [])
    .map((t) => normalizeName(t))
    .filter(Boolean);

  const servings = Number(legacy.servings);
  const prepTime = Number(legacy.prepTime);
  const cookTime = Number(legacy.cookTime);

  return {
    name,
    ingredients: parseIngredients(legacy.ingredients),
    instructions: parseInstructions(legacy.instructions),
    source: 'legacy',
    legacyId,
    createdAt: createdAt ?? new Date().toISOString(),
    tags: [...new Set([...tags, 'legacy'])],
    servings: Number.isFinite(servings) && servings > 0 ? servings : 4,
    difficulty: DIFFICULTIES.includes(legacy.difficulty) ? legacy.difficulty : 'medium',
    timesCooked: 0,
    prepTime: Number.isFinite(prepTime) && prepTime >= 0 ? prepTime : null,
    cookTime: Number.isFinite(cookTime) && cookTime >= 0 ? cookTime : null,
    imageUrl: legacy.imageUrl || null,
    sourceId: null,
  };
};

module.exports = {
  UNITS,
  DIFFICULTIES,
  normalizeName,
  parseIngredientString,
  parseIngredients,
  parseInstructions,
  transformLegacyRecipe,
};
