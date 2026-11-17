// src/utils/ingredientMeasure.js
// Turning recipe ingredient lines into shopping list lines.
//
// A recipe says "Boneless Skinless Chicken Breast, Cut Into Bite-Sized Pieces"
// and "0.33 cup". A shopping list wants "chicken breast" and "⅓ cup". Two
// recipes that both use balsamic glaze — one "for serving" — are one thing to
// buy, and "1 tbsp" plus "2 tsp" of thyme is one amount, not two rows.
//
// Everything here is pure and has a CommonJS twin in
// functions/src/board/ingredientMeasure.js, because the board API serves the
// same list. src/hooks/__tests__/shoppingList.contract.test.js runs both over
// one corpus: a change here belongs there too, in the same commit.

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * Words that describe how an ingredient is prepared or how big it is, not what
 * to buy. Only stripped from the front of a name, and never when the next word
 * is "or"/"and" — "fresh or dried cranberries" is a choice, not prep.
 */
const LEADING_PREP = new Set([
  'fresh',
  'freshly',
  'chopped',
  'minced',
  'diced',
  'sliced',
  'grated',
  'shredded',
  'crushed',
  'finely',
  'roughly',
  'coarsely',
  'thinly',
  'peeled',
  'trimmed',
  'halved',
  'cubed',
  'large',
  'medium',
  'small',
  'boneless',
  'skinless',
  'ripe',
  'canned',
  'packed',
  'heaping',
  'softened',
  'melted',
  'cold',
  'warm',
  'room-temperature',
]);

/** Trailing serving notes that arrive without a comma before them. */
const TRAILING_NOTE =
  /\s+(?:for|to)\s+(?:serving|serve|garnish|garnishing|taste|drizzling|drizzle|dusting|frying|greasing)\b.*$/;

/**
 * What to buy, without the prep notes: lower case, no parentheses, nothing
 * after the first comma ("steak, such as sirloin" → "steak"), no leading prep
 * words ("grated parmesan cheese" → "parmesan cheese").
 */
export const cleanIngredientName = (name) => {
  const segments = String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/,|;|\s[-–—]\s/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  // "Boneless, skinless chicken thighs": the first segment is all prep, so the
  // ingredient is the first segment that is not.
  const isAllPrep = (segment) => segment.split(/\s+/).every((word) => LEADING_PREP.has(word));
  const first = segments.find((segment) => !isAllPrep(segment)) ?? segments[0] ?? '';

  let text = first
    .replace(TRAILING_NOTE, '')
    .replace(/[^a-z0-9\s'&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let words = text.split(' ');
  while (
    words.length > 1 &&
    LEADING_PREP.has(words[0]) &&
    words[1] !== 'or' &&
    words[1] !== 'and'
  ) {
    words = words.slice(1);
  }
  // "fresh and chopped …" is rare enough; "and" left dangling at the front is not.
  if (words.length > 1 && (words[0] === 'and' || words[0] === 'or')) words = words.slice(1);
  text = words.join(' ');

  return text;
};

/** Words whose trailing "s" is not a plural. */
const NOT_PLURAL = new Set([
  'asparagus',
  'hummus',
  'couscous',
  'molasses',
  'swiss',
  'brussels',
  'citrus',
  'octopus',
  'grits',
  'oats',
  'greens',
  'lentils',
]);

const IRREGULAR = { leaves: 'leaf', loaves: 'loaf', halves: 'half', knives: 'knife' };

/** One word, singular. Good enough for food: tomatoes, berries, leaves, peas. */
export const singularize = (word) => {
  const w = String(word ?? '');
  if (w.length < 4 || NOT_PLURAL.has(w)) return w;
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (/(?:ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
};

/**
 * The identity of an ingredient on the list: cleaned and singular, so
 * "Carrots, peeled and chopped" and "carrot" are the same errand.
 */
export const ingredientKey = (name) => {
  const cleaned = cleanIngredientName(name);
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.join(' ');
};

/**
 * The things an "or" ingredient could be bought as, each as an ingredient key:
 * "vegetable or chicken broth" → ["vegetable broth", "chicken broth"],
 * "fresh or dried cranberries" → ["cranberry", "dried cranberry"].
 * Empty for an ingredient with no choice in it.
 */
export const ingredientAlternatives = (key) => {
  const parts = String(key ?? '')
    .split(' or ')
    .map((part) => part.trim());
  if (parts.length < 2 || parts.some((part) => !part)) return [];
  const last = parts[parts.length - 1].split(' ');
  const head = last[last.length - 1];
  return parts
    .map((part) => (part.includes(' ') || part === head ? part : `${part} ${head}`))
    .map(ingredientKey)
    .filter(Boolean);
};

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const UNIT_ALIASES = {
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 'tsp.'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons', 'tbsp.'],
  cup: ['cup', 'cups', 'c'],
  'fl oz': ['fl oz', 'fl. oz', 'fl. oz.', 'floz', 'fluid ounce', 'fluid ounces'],
  pint: ['pint', 'pints', 'pt'],
  quart: ['quart', 'quarts', 'qt'],
  gallon: ['gallon', 'gallons', 'gal'],
  ml: ['ml', 'mls', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  g: ['g', 'gram', 'grams', 'gr'],
  kg: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'],
  oz: ['oz', 'ozs', 'ounce', 'ounces', 'oz.'],
  lb: ['lb', 'lbs', 'pound', 'pounds', 'lb.', 'lbs.'],
};

const ALIAS_TO_UNIT = new Map(
  Object.entries(UNIT_ALIASES).flatMap(([unit, aliases]) => aliases.map((a) => [a, unit]))
);

/**
 * How each unit converts within its kind. Volume is counted in teaspoons and
 * weight in grams. Ounces are weight: a recipe that means fluid ounces says so.
 */
const CONVERSIONS = {
  tsp: ['volume', 1],
  tbsp: ['volume', 3],
  'fl oz': ['volume', 6],
  cup: ['volume', 48],
  pint: ['volume', 96],
  quart: ['volume', 192],
  gallon: ['volume', 768],
  ml: ['volume', 0.2028841362],
  l: ['volume', 202.8841362],
  g: ['weight', 1],
  oz: ['weight', 28.349523125],
  lb: ['weight', 453.59237],
  kg: ['weight', 1000],
};

/** Units shown as abbreviations, which never take a plural. */
const ABBREVIATED = new Set(['tsp', 'tbsp', 'fl oz', 'ml', 'l', 'g', 'kg', 'oz', 'lb']);

/** "Tablespoons" → "tbsp", "Cans" → "can", "" → "". */
export const canonicalUnit = (unit) => {
  const raw = String(unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!raw) return '';
  if (ALIAS_TO_UNIT.has(raw)) return ALIAS_TO_UNIT.get(raw);
  const bare = raw.replace(/\.$/, '');
  if (ALIAS_TO_UNIT.has(bare)) return ALIAS_TO_UNIT.get(bare);
  return /^[a-z]+$/.test(bare) ? singularize(bare) : bare;
};

/**
 * Which amounts can be added together: every volume with every volume, every
 * weight with every weight, and anything else only with itself.
 */
export const measureKey = (unit) => {
  const canonical = canonicalUnit(unit);
  return CONVERSIONS[canonical]?.[0] ?? (canonical || 'count');
};

/**
 * `quantity` of `from` expressed in `to`, or null when the two cannot be
 * converted (a cup is not a gram, a can is not a clove).
 */
export const convertQuantity = (quantity, from, to) => {
  const a = canonicalUnit(from);
  const b = canonicalUnit(to);
  if (a === b) return Number(quantity) || 0;
  const ca = CONVERSIONS[a];
  const cb = CONVERSIONS[b];
  if (!ca || !cb || ca[0] !== cb[0]) return null;
  return ((Number(quantity) || 0) * ca[1]) / cb[1];
};

/** The bigger of two units of the same kind — the one a sum is shown in. */
export const largerUnit = (a, b) => {
  const ca = CONVERSIONS[a];
  const cb = CONVERSIONS[b];
  if (!ca || !cb) return a || b;
  return cb[1] > ca[1] ? b : a;
};

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const FRACTIONS = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
];

/** 0.33 → "⅓", 1.25 → "1¼", 2 → "2", 0.15 → "0.15". */
export const formatQuantity = (value) => {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return '';

  let whole = Math.floor(quantity);
  const rest = quantity - whole;
  if (rest < 0.02) return String(whole);
  if (rest > 0.98) return String(whole + 1);

  const [, glyph] = FRACTIONS.find(([fraction]) => Math.abs(rest - fraction) <= 0.02) ?? [
    null,
    null,
  ];
  if (glyph) return whole ? `${whole}${glyph}` : glyph;

  whole = Math.round(quantity * 100) / 100;
  return String(whole);
};

const pluralWord = (word) => {
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (word.endsWith('f')) return `${word.slice(0, -1)}ves`;
  return `${word}s`;
};

/** "cup" for one, "cups" for more; abbreviations never change. */
export const displayUnit = (unit, quantity) => {
  const canonical = canonicalUnit(unit);
  if (!canonical || ABBREVIATED.has(canonical)) return canonical;
  if (Number(quantity) > 1 && /^[a-z]+$/.test(canonical)) return pluralWord(canonical);
  return canonical;
};

/** "1¼ tsp", "2 cups", "3", or "" — the amount as a shopper reads it. */
export const formatAmount = (quantity, unit) => {
  const number = formatQuantity(quantity);
  const shownUnit = displayUnit(unit, quantity);
  if (!number) return shownUnit;
  return shownUnit ? `${number} ${shownUnit}` : number;
};
