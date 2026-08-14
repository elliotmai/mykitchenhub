// functions/src/hellofresh/recipeNormalizer.js
//
// Turns whatever a HelloFresh card or web page gives us into a document that
// satisfies the `recipes` contract in firestore/firestore.rules:
//
//   name, ingredients, instructions, source, createdAt, tags, servings,
//   difficulty, timesCooked
//
// `createdAt` is deliberately NOT set here. The Cloud Function only parses —
// the browser writes the recipe under the signed-in user's credentials, and
// stamps createdAt itself. That keeps the security rules doing their job
// instead of an unauthenticated HTTP function writing on a user's behalf.

const DIFFICULTIES = ['easy', 'medium', 'hard'];

// Canonical units. Anything not in here is kept verbatim (lower-cased) so a
// HelloFresh-specific unit like "sachet" survives instead of being flattened.
const UNIT_ALIASES = {
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbs: 'tbsp',
  tbsp: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsp: 'tsp',
  cup: 'cup',
  cups: 'cup',
  ounce: 'oz',
  ounces: 'oz',
  oz: 'oz',
  pound: 'lb',
  pounds: 'lb',
  lb: 'lb',
  lbs: 'lb',
  gram: 'g',
  grams: 'g',
  g: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  kg: 'kg',
  milliliter: 'ml',
  milliliters: 'ml',
  ml: 'ml',
  liter: 'l',
  liters: 'l',
  l: 'l',
  clove: 'clove',
  cloves: 'clove',
  unit: 'unit',
  units: 'unit',
  piece: 'unit',
  pieces: 'unit',
  whole: 'unit',
};

// Units a HelloFresh card writes without a space ("28g Tomato Paste").
const UNIT_PATTERN =
  '(?:tablespoons?|tbsp|tbs|teaspoons?|tsp|cups?|ounces?|oz|pounds?|lbs?|grams?|g|kilograms?|kg|milliliters?|ml|liters?|l|cloves?|units?|pieces?|whole|sachets?|packets?|thumbs?|bunch(?:es)?|cans?|tins?|slices?)';

const FRACTIONS = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅕': 0.2,
  '⅙': 1 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/** Lower-cased, punctuation-free name used to match a recipe line to inventory. */
function normalizeIngredientName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // drop "(optional)", "(divided)"
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map a unit to its canonical short form, keeping unknown units intact. */
function normalizeUnit(unit) {
  const raw = String(unit ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!raw) return '';
  return UNIT_ALIASES[raw] ?? raw;
}

/**
 * Parse the leading amount of an ingredient string.
 * Handles "2", "1.5", "1/2", "1 1/2", "½" and "1½".
 *
 * @returns {{ quantity: number, rest: string }}
 */
function parseQuantity(text) {
  let str = String(text ?? '').trim();
  if (!str) return { quantity: 1, rest: '' };

  // Expand a leading vulgar fraction so the numeric matchers below see digits.
  str = str.replace(/^(\d*)([½⅓⅔¼¾⅕⅙⅛⅜⅝⅞])/, (_m, whole, glyph) => {
    const value = (whole ? Number(whole) : 0) + FRACTIONS[glyph];
    return String(Number(value.toFixed(4)));
  });

  const mixed = str.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*/);
  if (mixed) {
    const [, whole, num, den] = mixed;
    const denominator = Number(den);
    if (denominator !== 0) {
      return {
        quantity: Number(whole) + Number(num) / denominator,
        rest: str.slice(mixed[0].length).trim(),
      };
    }
  }

  const fraction = str.match(/^(\d+)\s*\/\s*(\d+)\s*/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator !== 0) {
      return {
        quantity: Number(fraction[1]) / denominator,
        rest: str.slice(fraction[0].length).trim(),
      };
    }
  }

  const decimal = str.match(/^(\d+(?:\.\d+)?)\s*/);
  if (decimal) {
    return { quantity: Number(decimal[1]), rest: str.slice(decimal[0].length).trim() };
  }

  return { quantity: 1, rest: str };
}

/**
 * Normalise one ingredient, whether it arrives as a string ("2 cloves garlic")
 * or as an object the vision model already split up.
 *
 * @returns {{ name: string, quantity: number, unit: string, normalized: string }|null}
 *          null when there is no usable name.
 */
function normalizeIngredient(raw) {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'object') {
    const name = String(raw.name ?? '').trim();
    if (!name) return null;

    // A model sometimes puts the whole line in `name` and leaves quantity at 1.
    const hasQuantity = Number.isFinite(Number(raw.quantity)) && Number(raw.quantity) > 0;
    const parsedName = hasQuantity ? { quantity: Number(raw.quantity), rest: name } : parseQuantity(name);

    let unit = normalizeUnit(raw.unit);
    let display = parsedName.rest;

    if (!unit) {
      const leading = display.match(new RegExp(`^${UNIT_PATTERN}\\b\\.?\\s*`, 'i'));
      if (leading) {
        unit = normalizeUnit(leading[0]);
        display = display.slice(leading[0].length).trim();
      }
    }

    display = display.replace(/^(?:of|the)\s+/i, '').trim() || name;

    return {
      name: display,
      quantity: parsedName.quantity > 0 ? parsedName.quantity : 1,
      unit,
      normalized: normalizeIngredientName(display),
    };
  }

  const line = String(raw).trim();
  if (!line) return null;

  // "28g Tomato Paste" — split the unit off a number it is glued to.
  const glued = line.replace(new RegExp(`^(\\d+(?:\\.\\d+)?)(${UNIT_PATTERN})\\b`, 'i'), '$1 $2 ');
  const { quantity, rest } = parseQuantity(glued);

  let unit = '';
  let display = rest;
  const leading = display.match(new RegExp(`^${UNIT_PATTERN}\\b\\.?\\s*`, 'i'));
  if (leading) {
    unit = normalizeUnit(leading[0]);
    display = display.slice(leading[0].length).trim();
  }

  display = display.replace(/^(?:of|the)\s+/i, '').trim();
  if (!display) return null;

  return {
    name: display,
    quantity: quantity > 0 ? quantity : 1,
    unit,
    normalized: normalizeIngredientName(display),
  };
}

/** Instructions may arrive as a list, a numbered blob, or a single paragraph. */
function normalizeInstructions(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((step) => (typeof step === 'object' && step !== null ? step.text : step))
      .map((step) => String(step ?? '').trim())
      .filter(Boolean);
  }

  const text = String(raw ?? '').trim();
  if (!text) return [];

  // "1. Preheat… 2. Roast…" — split on the numbering, not on every period.
  if (/(^|\s)\d+[.)]\s/.test(text)) {
    return text
      .split(/(?:^|\s)\d+[.)]\s+/)
      .map((step) => step.trim())
      .filter(Boolean);
  }

  return text
    .split(/\r?\n+/)
    .map((step) => step.trim())
    .filter(Boolean);
}

/** Whole minutes, or null when the source did not say. */
function normalizeMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return Math.round(minutes);
}

/**
 * Difficulty when the source did not give one. HelloFresh cards are graded by
 * how long they take more than by technique, so total time is a fair proxy.
 */
function inferDifficulty(prepTime, cookTime) {
  const total = (normalizeMinutes(prepTime) ?? 0) + (normalizeMinutes(cookTime) ?? 0);
  if (total === 0) return 'easy';
  if (total <= 25) return 'easy';
  if (total <= 50) return 'medium';
  return 'hard';
}

function normalizeTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const seen = new Set();
  const tags = [];

  list.forEach((tag) => {
    const clean = String(tag ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      tags.push(clean);
    }
  });

  return tags;
}

function normalizeServings(value) {
  const servings = Math.round(Number(value));
  // The rules require servings > 0, and a HelloFresh box is two portions.
  if (!Number.isFinite(servings) || servings <= 0) return 2;
  return servings;
}

/**
 * Build a `recipes` document from a parsed card or page.
 *
 * @param {object} raw            whatever the vision model or scraper produced
 * @param {object} [options]
 * @param {string} [options.sourceUrl]  the HelloFresh URL, when there was one
 * @param {string} [options.imageUrl]   hero image, when the source had one
 * @returns {{ recipe: object, warnings: string[] }}
 */
function normalizeRecipe(raw = {}, options = {}) {
  const warnings = [];

  const name = String(raw.name ?? raw.title ?? '').trim();
  if (!name) warnings.push('No recipe name was found — add one before saving.');

  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : [])
    .map(normalizeIngredient)
    .filter(Boolean);
  if (ingredients.length === 0) {
    warnings.push('No ingredients were read — add them before saving.');
  }

  const instructions = normalizeInstructions(raw.instructions);
  if (instructions.length === 0) {
    warnings.push('No cooking steps were read — add them before saving.');
  }

  const prepTime = normalizeMinutes(raw.prepTime);
  const cookTime = normalizeMinutes(raw.cookTime);

  const difficulty = DIFFICULTIES.includes(String(raw.difficulty ?? '').toLowerCase())
    ? String(raw.difficulty).toLowerCase()
    : inferDifficulty(prepTime, cookTime);

  const tags = normalizeTags(raw.tags);
  if (!tags.includes('hellofresh')) tags.unshift('hellofresh');

  const recipe = {
    name: name || 'Untitled HelloFresh Recipe',
    ingredients,
    instructions,
    source: 'hellofresh',
    tags,
    prepTime,
    cookTime,
    servings: normalizeServings(raw.servings),
    difficulty,
    timesCooked: 0,
    imageUrl: options.imageUrl ?? raw.imageUrl ?? null,
    sourceUrl: options.sourceUrl ?? raw.sourceUrl ?? null,
  };

  (Array.isArray(raw.warnings) ? raw.warnings : []).forEach((warning) => {
    const clean = String(warning ?? '').trim();
    if (clean) warnings.push(clean);
  });

  return { recipe, warnings };
}

module.exports = {
  DIFFICULTIES,
  inferDifficulty,
  normalizeIngredient,
  normalizeIngredientName,
  normalizeInstructions,
  normalizeMinutes,
  normalizeRecipe,
  normalizeServings,
  normalizeTags,
  normalizeUnit,
  parseQuantity,
};
