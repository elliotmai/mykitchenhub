// functions/src/board/recipeCards.js
// A `recipes` document as Fridge Board's step-by-step cards.
//
// What KitchenHub actually stores (firestore/SCHEMA_DOCUMENTATION.md §4, and
// the writers in functions/src/hellofresh/recipeNormalizer.js,
// functions/src/recipes/transformLegacyRecipe.js and src/utils/recipeImport.js):
//
//   instructions  an array of plain strings, one per step. Older legacy
//                 imports hold one blob of text instead, so that is read too.
//                 The Markdown importer folds a `### Group` heading into the
//                 step as "Group: step text", which is where a card title can
//                 come from. No writer stores per-step ingredient references
//                 or timers.
//   ingredients   [{ name, quantity, unit, normalized, text? }] — `text` is the
//                 line as the source printed it, when the importer kept it.
//   prepTime, cookTime   minutes or null; the app shows their sum.
//   servings      a number.
//   description   optional free text (Markdown and pasted imports).
//   nutrition     optional { calories: "450", ... } from the Markdown importer.
//
// So most of a card is read straight off the document, the title is taken from
// a "Heading:" prefix when there is one, and the timer is read out of the
// step's own wording ("simmer for 10–12 minutes" → 10).

/** The placeholder src/utils/recipeImport.js saves when a recipe had no steps. */
const MISSING_STEPS_PLACEHOLDER = 'No steps were saved for this recipe — edit it to add them.';

/** A one-paragraph blob longer than this is split into sentence-sized steps. */
const LONG_PARAGRAPH = 320;

/** Sentences per step when a single paragraph has to be split. */
const SENTENCES_PER_STEP = 2;

const clean = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// Ingredient lines
// ---------------------------------------------------------------------------

const FRACTIONS = [
  [1 / 8, '1/8'],
  [1 / 4, '1/4'],
  [1 / 3, '1/3'],
  [3 / 8, '3/8'],
  [1 / 2, '1/2'],
  [5 / 8, '5/8'],
  [2 / 3, '2/3'],
  [3 / 4, '3/4'],
  [7 / 8, '7/8'],
];

/** 0.5 → "1/2", 1.5 → "1 1/2", 2 → "2", 0.3 → "0.3". */
const formatQuantity = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const whole = Math.floor(n);
  const part = n - whole;
  if (part < 0.01) return String(whole);
  const fraction = FRACTIONS.find(([v]) => Math.abs(v - part) < 0.01);
  if (fraction) return whole ? `${whole} ${fraction[1]}` : fraction[1];
  return String(Math.round(n * 100) / 100);
};

/** "10 oz ground beef" for one stored ingredient, or '' if it has no name. */
const ingredientLine = (ingredient) => {
  if (ingredient === null || ingredient === undefined) return '';
  if (typeof ingredient !== 'object') return clean(ingredient);

  // The importer's own copy of the printed line is the most faithful version.
  if (clean(ingredient.text)) return clean(ingredient.text);

  const name = clean(ingredient.name ?? ingredient.normalized);
  if (!name) return '';
  return clean([formatQuantity(ingredient.quantity), clean(ingredient.unit), name].join(' '));
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * Minutes a step tells the cook to wait, or null.
 *
 * "Roast for 15 minutes" → 15. "Simmer 10–12 min" → 10, the lower bound, so a
 * timer goes off at the first moment worth checking rather than after it. "1
 * hour" → 60. Seconds are ignored: a 30-second stir is not worth a timer.
 */
const DURATION =
  /(\d+(?:\.\d+)?)\s*(?:(?:-|–|—|to)\s*\d+(?:\.\d+)?\s*)?(minutes?|mins?\b|min\b|hours?|hrs?\b|hr\b)/i;

const timerMinutes = (text) => {
  const match = String(text ?? '').match(DURATION);
  if (!match) return null;
  const amount = Number(match[1]);
  const minutes = /^h/i.test(match[2]) ? amount * 60 : amount;
  const rounded = Math.round(minutes);
  return rounded > 0 ? rounded : null;
};

/** "Step 3:", "3.", "3)" at the start of a step — the card is numbered already. */
const STEP_NUMBER = /^\s*(?:step\s*\d+\s*[:.)-]?\s*|\d+[.)]\s+)/i;

/**
 * "Make the sauce: Whisk the soy…" → a title and the rest.
 *
 * Only a short prefix of a few words counts: "Heat oven to 220C: …" is a
 * sentence with a colon in it, not a heading.
 */
const TITLE_PREFIX = /^([^:.!?\n]{2,40}):\s+([\s\S]+)$/;

const splitTitle = (text) => {
  const match = text.match(TITLE_PREFIX);
  if (!match) return { title: null, body: text };
  const title = match[1].trim();
  if (title.split(/\s+/).length > 5 || /\d/.test(title)) return { title: null, body: text };
  return { title, body: match[2].trim() };
};

/** A step's text as paragraphs. */
const paragraphs = (text) =>
  String(text ?? '')
    .split(/\r?\n+/)
    .map(clean)
    .filter(Boolean);

/** Sentences, keeping their punctuation. */
const sentences = (text) =>
  (clean(text).match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || []).map(clean).filter(Boolean);

/**
 * Old legacy recipes keep every step in one string. Split it the way a cook
 * would read it: on its own numbering if it has any, then on line breaks, and
 * only as a last resort — one long paragraph — into pairs of sentences.
 */
const splitBlob = (text) => {
  const value = String(text ?? '').trim();
  if (!value) return [];

  if (/(^|\s)\d+[.)]\s/.test(value)) {
    return value
      .split(/(?:^|\s)\d+[.)]\s+/)
      .map((step) => step.trim())
      .filter(Boolean);
  }

  const lines = value
    .split(/\r?\n\s*\r?\n|\r?\n/)
    .map((step) => step.trim())
    .filter(Boolean);
  if (lines.length > 1 || value.length <= LONG_PARAGRAPH) return lines;

  const all = sentences(value);
  const steps = [];
  for (let i = 0; i < all.length; i += SENTENCES_PER_STEP) {
    steps.push(all.slice(i, i + SENTENCES_PER_STEP).join(' '));
  }
  return steps;
};

/** Ingredient lines a structured step says it uses, when a writer stored any. */
const stepUses = (step) => {
  const list = Array.isArray(step?.uses)
    ? step.uses
    : Array.isArray(step?.ingredients)
      ? step.ingredients
      : [];
  return list.map(ingredientLine).filter(Boolean);
};

/** One stored step — a string, or an object some writer may add later — as a card. */
const toCard = (step, index) => {
  const structured = step !== null && typeof step === 'object';
  const raw = structured ? (step.text ?? step.instruction ?? step.description ?? '') : step;
  const rawText = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');

  const unnumbered = rawText.replace(STEP_NUMBER, '');
  const storedTitle = structured ? clean(step.title ?? step.name) : '';
  const { title, body } = storedTitle
    ? { title: storedTitle, body: unnumbered }
    : splitTitle(unnumbered);

  const text = paragraphs(body);
  if (text.length === 0) return null;

  const card = {
    title: title || `Step ${index + 1}`,
    text,
    uses: structured ? stepUses(step) : [],
  };

  const storedTimer = structured ? Number(step.timer ?? step.minutes) : NaN;
  const timer =
    Number.isFinite(storedTimer) && storedTimer > 0
      ? Math.round(storedTimer)
      : timerMinutes(text.join(' '));
  if (timer) card.timer = timer;
  return card;
};

/** The recipe's instructions as numbered cards. */
const recipeSteps = (instructions) => {
  const list = Array.isArray(instructions) ? instructions : splitBlob(instructions);
  const steps = list.filter((step) => {
    if (step === null || step === undefined) return false;
    if (typeof step === 'string') return step.trim() && step.trim() !== MISSING_STEPS_PLACEHOLDER;
    return typeof step === 'object';
  });

  // Numbered after filtering, so a dropped blank never leaves "Step 2" as the first card.
  const cards = [];
  steps.forEach((step) => {
    const card = toCard(step, cards.length);
    if (card) cards.push(card);
  });
  return cards;
};

// ---------------------------------------------------------------------------
// The card header
// ---------------------------------------------------------------------------

/** Prep plus cook, as the recipe page shows it — see `totalTime` in useRecipes.js. */
const totalMinutes = (recipe) => {
  const total = (Number(recipe?.prepTime) || 0) + (Number(recipe?.cookTime) || 0);
  return total > 0 ? total : null;
};

/** 35 → "35 min", 60 → "1 hr", 70 → "1 hr 10 min". */
const formatMinutes = (minutes) => {
  if (!minutes) return null;
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
};

/** Calories per serving from `nutrition` ("450", "450 kcal") or a bare number field. */
const calories = (recipe) => {
  if (Number.isFinite(Number(recipe?.calories)) && Number(recipe.calories) > 0) {
    return Math.round(Number(recipe.calories));
  }
  const nutrition = recipe?.nutrition;
  if (!nutrition || typeof nutrition !== 'object') return null;
  const key = Object.keys(nutrition).find((k) =>
    /^(calories|calorie|cal|kcal|energy)$/i.test(k.trim())
  );
  if (!key) return null;
  const match = String(nutrition[key])
    .replace(/,/g, '')
    .match(/\d+(?:\.\d+)?/);
  return match ? Math.round(Number(match[0])) : null;
};

/** A one-line subtitle: the first line of the description, if the recipe has one. */
const subtitle = (recipe) => {
  const source = recipe?.subtitle ?? recipe?.headline ?? recipe?.description;
  const [first] = paragraphs(source);
  return first || null;
};

/**
 * The full card for one recipe document.
 *
 * @param {object} recipe       the stored `recipes/{id}` document
 * @param {string} [fallbackName]  the meal's denormalised recipeName
 */
const toRecipeCard = (recipe = {}, fallbackName = '') => {
  const servings = Number(recipe.servings);
  return {
    name: clean(recipe.name ?? recipe.title) || clean(fallbackName) || 'Untitled recipe',
    sub: subtitle(recipe),
    time: formatMinutes(totalMinutes(recipe)),
    serves: Number.isFinite(servings) && servings > 0 ? servings : null,
    cal: calories(recipe),
    ingredients: (Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
      .map(ingredientLine)
      .filter(Boolean),
    steps: recipeSteps(recipe.instructions ?? recipe.steps),
  };
};

module.exports = {
  MISSING_STEPS_PLACEHOLDER,
  formatQuantity,
  ingredientLine,
  timerMinutes,
  splitTitle,
  splitBlob,
  recipeSteps,
  formatMinutes,
  calories,
  toRecipeCard,
};
