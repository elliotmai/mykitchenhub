// src/components/Recipes/cookPlan.js
// How cook mode lays a recipe out: which ingredients each step uses, and
// which steps can be done at the same time.
//
// Recipes are saved as plain sentences, so this reads them the way a cook
// would. Two things matter:
//
//  - A step uses an ingredient when it names it. "Toss the potatoes in the
//    oil" uses the potatoes and the oil, so that card shows "1½ lb potatoes"
//    and "2 tbsp olive oil" right beside the words.
//
//  - Some steps leave the cook's hands free: the oven preheats, the pasta
//    boils for 10 minutes, the dough rests. The prep that follows ("chop the
//    parsley", "whisk the dressing") can happen during that wait, and a step
//    that opens with "Meanwhile" says so outright. Those go on one card, the
//    wait first and the hands-on work under it, so nobody stands watching an
//    oven with a pile of onions still to chop.
//
// It errs on the side of keeping steps apart: a step that touches what is
// cooking ("drain", "remove from the oven", "once it is done") is never
// pulled forward.

import { stepMinutes } from '../../timers/timerLogic';

/** Steps that run on their own once started. */
const PASSIVE =
  /\b(bake|baking|roast|roasting|simmer|simmering|boil|boiling|braise|braising|rest|resting|marinate|marinating|chill|chilling|refrigerate|freeze|rise|rising|proof|proofing|cool|cooling|steam|steaming|soak|soaking|slow[- ]cook|pressure[- ]cook|pre-?heat|preheating|bring .{0,40}\bto a boil)\b/i;

/** The start of a hands-on prep step. */
const PREP =
  /^(?:\W*)(?:now,?\s+|next,?\s+|then,?\s+)?(chop|dice|slice|mince|grate|shred|peel|trim|cut|halve|quarter|core|seed|pit|crush|zest|juice|squeeze|rinse|wash|pat|dry|measure|prepare|prep|make|whisk|mix|combine|stir together|toss|season|mash|crumble|tear|pick|wipe|line|grease|set out|gather)\b/i;

/** Says outright that it happens alongside what came before. */
const MEANWHILE = /^(?:\W*)(meanwhile|in the meantime|while)\b/i;

/** Touches what is cooking, or waits for it: never done alongside it. */
const DEPENDS =
  /\b(remove|take (?:it |them )?out|drain|serve|serving|plate|transfer|return|once|when (?:it|they|the|done)|after|until done|from the (?:oven|pot|pan)|baked|roasted|boiled|cooked|pour (?:it |them )?over|top with)\b/i;

/** Never put more than this many steps beside one wait. */
const MAX_MEANWHILE = 3;

/** A wait shorter than this isn't worth starting something else in. */
const MIN_WAIT_MINUTES = 5;

/** Is this a step the cook can walk away from? */
export const isHandsOff = (text) => {
  const s = String(text ?? '');
  if (!PASSIVE.test(s)) return false;
  // Waiting on the oven or a pot of water: no minutes given, but a wait all the same.
  if (/\bpre-?heat|\bto a (?:rolling )?boil\b/i.test(s)) return true;
  const minutes = stepMinutes(s);
  return minutes != null && minutes >= MIN_WAIT_MINUTES;
};

/** Could this step be done while an earlier one cooks? */
export const canOverlap = (text) => {
  const s = String(text ?? '').trim();
  if (MEANWHILE.test(s)) return true;
  // A wait of its own ("toss with oil and roast 25 minutes") starts its own card.
  if (isHandsOff(s)) return false;
  return PREP.test(s) && !DEPENDS.test(s);
};

/**
 * Cards, in order. Each card is { steps: number[] } of step indexes; a card
 * with more than one step is a wait (`steps[0]`) and what to do during it.
 *
 * @param {string[]} steps
 * @returns {{ steps: number[], parallel: boolean }[]}
 */
export const planCards = (steps) => {
  const cards = [];
  let i = 0;
  while (i < steps.length) {
    const group = [i];
    if (isHandsOff(steps[i])) {
      let j = i + 1;
      while (j < steps.length && group.length <= MAX_MEANWHILE && canOverlap(steps[j])) {
        group.push(j);
        j += 1;
      }
    }
    cards.push({ steps: group, parallel: group.length > 1 });
    i += group.length;
  }
  return cards;
};

// ---------------------------------------------------------------------------
// Ingredients per step

const FRACTIONS = [
  [0.125, '⅛'],
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];

/** 1.5 → "1½", 0.333 → "⅓", "2" → "2". */
export const formatQuantity = (quantity) => {
  const n = Number(quantity);
  if (quantity == null || quantity === '' || Number.isNaN(n)) return String(quantity ?? '').trim();
  if (n <= 0) return '';
  const whole = Math.floor(n);
  const rest = n - whole;
  const frac = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.02);
  if (rest < 0.02) return String(whole);
  if (frac) return `${whole || ''}${frac[1]}`;
  return String(Math.round(n * 100) / 100);
};

/** What the ingredient is called, for matching against a step. */
const nameOf = (ingredient) => {
  if (typeof ingredient === 'string') return ingredient;
  return ingredient?.normalized || ingredient?.name || ingredient?.text || '';
};

/** "10 oz ground beef", or the line as written. */
export const ingredientLine = (ingredient) => {
  if (typeof ingredient === 'string') return ingredient.trim();
  if (!ingredient) return '';
  if (ingredient.text) return String(ingredient.text).trim();
  return [formatQuantity(ingredient.quantity), ingredient.unit, ingredient.name]
    .filter((p) => p != null && String(p).trim())
    .join(' ')
    .trim();
};

/** Splits an ingredient line into its amount and its name, for display. */
export const ingredientParts = (ingredient) => {
  if (ingredient && typeof ingredient === 'object' && ingredient.name && !ingredient.text) {
    const amount = [formatQuantity(ingredient.quantity), ingredient.unit]
      .filter((p) => p != null && String(p).trim())
      .join(' ');
    return { amount, name: String(ingredient.name).trim() };
  }
  const line = ingredientLine(ingredient);
  const m =
    /^([\d\s./½¼¾⅓⅔⅛-]+(?:\s*(?:cups?|tbsps?|tablespoons?|tsps?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|liters?|litres?|cloves?|cans?|pinch(?:es)?|dash(?:es)?|sticks?|slices?|bunch(?:es)?|sprigs?|heads?|packages?|pkgs?)\b\.?)?)\s+(.+)$/i.exec(
      line
    );
  return m ? { amount: m[1].trim(), name: m[2].trim() } : { amount: '', name: line };
};

const WORD = /[a-z]+/g;

/** Words that say nothing about which ingredient a step means. */
const FILLER = new Set([
  'and',
  'or',
  'of',
  'the',
  'a',
  'an',
  'to',
  'for',
  'fresh',
  'large',
  'small',
  'medium',
  'chopped',
  'diced',
  'minced',
  'sliced',
  'ground',
  'whole',
  'dried',
  'optional',
  'divided',
  'taste',
  'cup',
  'cups',
  'tbsp',
  'tsp',
  'oz',
  'lb',
  'lbs',
  'can',
  'cans',
  'clove',
  'cloves',
  'piece',
  'pieces',
  'extra',
  'virgin',
  'boneless',
  'skinless',
  'kosher',
  'unsalted',
  'packed',
  'plus',
  'more',
  'about',
]);

/** "tomatoes" and "tomato", "leaves" and "leaf", "berries" and "berry". */
const singular = (w) => {
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('oes') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ves') && w.length > 4) return `${w.slice(0, -3)}f`;
  if (w.endsWith('es') && /(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
};

const wordsOf = (text) =>
  (String(text).toLowerCase().match(WORD) || []).map(singular).filter((w) => w.length > 2);

/**
 * The words that pick an ingredient out in a step: its last real word (the
 * noun: "beef" of "ground beef", "oil" of "olive oil"), and the whole name.
 */
const keysFor = (ingredient) => {
  const words = wordsOf(nameOf(ingredient).replace(/\(.*?\)|,.*$/g, '')).filter(
    (w) => !FILLER.has(w)
  );
  if (!words.length) return null;
  return { phrase: words.join(' '), head: words[words.length - 1] };
};

/**
 * Indexes into `ingredients` of the ones a step names.
 *
 * @param {string} step
 * @param {Array<object|string>} ingredients
 * @returns {number[]}
 */
export const stepIngredientIndexes = (step, ingredients) => {
  const said = wordsOf(step);
  if (!said.length) return [];
  const text = ` ${said.join(' ')} `;
  const heads = new Map();
  const keys = ingredients.map(keysFor);
  keys.forEach((k) => {
    if (k) heads.set(k.head, (heads.get(k.head) || 0) + 1);
  });
  return keys.reduce((found, k, n) => {
    if (!k) return found;
    if (text.includes(` ${k.phrase} `)) return [...found, n];
    // A head word two ingredients share ("oil" in olive oil and sesame oil)
    // only counts when the step says which.
    if (heads.get(k.head) === 1 && text.includes(` ${k.head} `)) return [...found, n];
    return found;
  }, []);
};
