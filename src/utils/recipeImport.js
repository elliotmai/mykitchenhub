// src/utils/recipeImport.js
// Turns recipe Markdown into recipe drafts for the shared library.
//
// Two places that Markdown comes from:
//
//   * Pestle's "Export all" — a zip with one file per recipe:
//       # Name
//       <optional description>
//       **Category** dinner, soup        **Cuisine** japanese
//       **Total Time** 1h 10m            **Servings** 4.0 | Serves 2
//       **Rating** 4.5/5                 **Source** www.example.com
//       ## Ingredients   (* bullets, optional ### group headings)
//       ## Instructions  (1. numbered steps, optional ### group headings)
//       ## Notes / ## Nutrition (optional)
//
//   * A recipe a chat assistant (ChatGPT, Claude) wrote, pasted in. These
//     follow RECIPE_FORMAT_PROMPT when asked to, but the parser is lenient
//     about the usual drift: `**Servings:** 4`, `Prep time: 15 minutes`,
//     `### Ingredients`, `- ` or `•` bullets, `Step 1:` prefixes, a chatty
//     sentence before the recipe, code fences, several recipes in one paste.
//
// Everything here is pure so it can be tested without a browser or Firestore.

import { unzipSync, strFromU8 } from 'fflate';

const UNICODE_FRACTIONS = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅐': 1 / 7,
  '⅑': 1 / 9,
  '⅒': 0.1,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};
const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');

/** Units we recognise after a quantity. Size words (large, medium) stay in the name. */
const UNITS = new Map(
  Object.entries({
    tsp: 'tsp',
    tsps: 'tsp',
    teaspoon: 'tsp',
    teaspoons: 'tsp',
    tbsp: 'tbsp',
    tbsps: 'tbsp',
    tablespoon: 'tbsp',
    tablespoons: 'tbsp',
    cup: 'cup',
    cups: 'cups',
    oz: 'oz',
    ounce: 'oz',
    ounces: 'oz',
    'fl oz': 'fl oz',
    lb: 'lb',
    lbs: 'lbs',
    pound: 'lb',
    pounds: 'lbs',
    g: 'g',
    gram: 'g',
    grams: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    liter: 'l',
    liters: 'l',
    litre: 'l',
    litres: 'l',
    pt: 'pt',
    pint: 'pint',
    pints: 'pints',
    qt: 'qt',
    quart: 'quart',
    quarts: 'quarts',
    clove: 'clove',
    cloves: 'cloves',
    can: 'can',
    cans: 'cans',
    package: 'package',
    packages: 'packages',
    pkg: 'package',
    pinch: 'pinch',
    pinches: 'pinches',
    dash: 'dash',
    slice: 'slice',
    slices: 'slices',
    stick: 'stick',
    sticks: 'sticks',
    bunch: 'bunch',
    bunches: 'bunches',
    sprig: 'sprig',
    sprigs: 'sprigs',
    head: 'head',
    heads: 'heads',
    piece: 'piece',
    pieces: 'pieces',
    jar: 'jar',
    jars: 'jars',
    bag: 'bag',
    bags: 'bags',
    // HelloFresh's "1 unit Mini Cucumber" means a count, not a unit.
    unit: '',
    units: '',
  })
);

/** "1", "1.5", "½", "1½", "1 ½", "1 1/2", "3⁄4", "1/2" → number, or null. */
export const parseAmount = (raw) => {
  const text = String(raw ?? '')
    .replace(/⁄/g, '/')
    .trim();
  if (!text) return null;

  let total = 0;
  let matched = false;
  for (const part of text.split(/\s+/)) {
    const m = part.match(new RegExp(`^(\\d+(?:\\.\\d+)?)?([${FRACTION_CHARS}])?$`));
    const slash = part.match(/^(\d+)\/(\d+)$/);
    if (slash && Number(slash[2]) > 0) {
      total += Number(slash[1]) / Number(slash[2]);
      matched = true;
    } else if (m && (m[1] || m[2])) {
      total += (m[1] ? Number(m[1]) : 0) + (m[2] ? UNICODE_FRACTIONS[m[2]] : 0);
      matched = true;
    } else {
      return null;
    }
  }
  return matched && total > 0 ? Math.round(total * 1000) / 1000 : null;
};

// A leading amount: digits/fractions, optionally a mixed number, optionally a
// range ("2-3", "2 to 3") whose upper bound we drop.
const NUM = `(?:\\d+(?:\\.\\d+)?(?:\\s*[${FRACTION_CHARS}])?|[${FRACTION_CHARS}]|\\d+\\s*[⁄/]\\s*\\d+)`;
const AMOUNT_RE = new RegExp(
  `^(${NUM}(?:\\s+\\d+\\s*[⁄/]\\s*\\d+)?)(?:\\s*(?:-|–|to)\\s*${NUM}(?:\\s+\\d+\\s*[⁄/]\\s*\\d+)?)?\\s+`
);

const GLUED_RE = /^(\d+(?:\.\d+)?)\s?(g|kg|ml|l|oz|lb|lbs)\b\.?\s*/i;
// The imperial (or metric) twin that follows: "/ 2.8oz", "/ 1 3/4 cups", "/9oz".
const ALT_MEASURE_RE = new RegExp(
  `^\\/\\s*${NUM}(?:\\s+\\d+\\s*[⁄/]\\s*\\d+)?\\s*(?:fl\\.? oz|[A-Za-z]+)?\\.?\\s+`
);

/** Tidy Pestle's doubled parentheses: "potatoes ((5 medium), peeled)" → "potatoes (5 medium, peeled)". */
const tidyName = (name) =>
  name
    .replace(/\(\(([^()]*)\)\)/g, '($1)')
    .replace(/\(\(([^()]*)\)([^()]*)\)/g, '($1$2)')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,)])/g, '$1')
    .trim();

/** Lower-cased, punctuation-free name used to match against inventory. */
export const normalizeIngredient = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * One Pestle ingredient bullet → `{ name, quantity, unit, normalized, text }`.
 * Lines with no amount ("Salt", "Cooking Oil") get quantity 1 and no unit —
 * the library requires a positive quantity — with the original kept in `text`.
 */
export const parseIngredientLine = (line) => {
  const text = String(line ?? '')
    .replace(/^\s*[*-](\s+|$)/, '')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return null; // empty bullet

  let quantity = null;
  let unit = '';
  let rest = text;

  // "2x 250g/9oz Chicken Breasts" — a count of packs.
  const times = text.match(/^(\d+)\s*x\s+/i);
  // "300g pasta", "60mL / 1/4 cup wine", "2.8oz butter" — metric-first lines
  // glue the unit to the number and often add a second measure after a slash.
  const glued = !times && text.match(GLUED_RE);
  const amount = !times && !glued && text.match(AMOUNT_RE);
  if (times) {
    quantity = Number(times[1]) || null;
    rest = text.slice(times[0].length);
  } else if (glued) {
    quantity = Number(glued[1]) || null;
    unit = UNITS.get(glued[2].toLowerCase()) ?? glued[2];
    rest = text.slice(glued[0].length).replace(ALT_MEASURE_RE, '');
  } else if (amount) {
    quantity = parseAmount(amount[1]);
    if (quantity !== null) {
      rest = text.slice(amount[0].length);
      const unitMatch = rest.match(/^(fl\.? oz|[A-Za-z]+)\.?(?=\s|$)/);
      if (unitMatch) {
        const key = unitMatch[1].toLowerCase().replace('fl. oz', 'fl oz');
        if (UNITS.has(key)) {
          unit = UNITS.get(key);
          rest = rest.slice(unitMatch[0].length).trim();
        }
      }
    }
  }

  // "5 cloves" — the unit was the whole ingredient.
  if (!tidyName(rest) && unit) {
    rest = unit;
    unit = '';
  }
  const name = tidyName(rest) || tidyName(text);
  return {
    name,
    quantity: quantity ?? 1,
    unit,
    normalized: normalizeIngredient(name) || normalizeIngredient(text),
    text,
  };
};

/** "1h 10m", "45m", "2h", "90 min" → minutes, or null. */
export const parseDuration = (raw) => {
  const text = String(raw ?? '').toLowerCase();
  const hours = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const mins = text.match(/(\d+(?:\.\d+)?)\s*m/);
  if (!hours && !mins) {
    const bare = text.match(/^\s*(\d+)\s*$/);
    return bare ? Number(bare[1]) : null;
  }
  const total = (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
  return total > 0 ? Math.round(total) : null;
};

/** "4.0", "Serves 2", "4-6", "12 pierogi" → first number, or null. */
export const parseServings = (raw) => {
  const m = String(raw ?? '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return n > 0 ? n : null;
};

/** Pestle names HelloFresh cards "2025 W48 R207 Chicken & …" — drop the week code. */
export const cleanRecipeName = (raw) =>
  String(raw ?? '')
    .replace(/^\s*\d{4}\s+W\d+\s+R\d+\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const splitList = (value) =>
  String(value ?? '')
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

/** Strip Markdown emphasis and stray bullet markers from a short label. */
const plain = (value) =>
  String(value ?? '')
    .replace(/^\s*(?:[-*•]\s+)?/, '')
    .replace(/[*_`]/g, '')
    .trim();

/** Header field keys we understand, mapped to what they set. */
const FIELD_KEYS = [
  [/^(category|categories|course|meal|meal type)$/, 'categories'],
  [/^(cuisine|cuisines)$/, 'cuisines'],
  [/^(tags?|keywords)$/, 'tags'],
  [/^(total time|time|ready in)$/, 'totalTime'],
  [/^(prep time|prep|preparation time)$/, 'prepTime'],
  [/^(cook time|cook|cooking time|bake time)$/, 'cookTime'],
  [/^(servings|serves|yield|yields|makes|portions)$/, 'servings'],
  [/^(rating)$/, 'rating'],
  [/^(source|source url|url|from|adapted from)$/, 'source'],
  [/^(difficulty)$/, 'difficulty'],
  [/^(description|summary)$/, 'description'],
];

const fieldFor = (key) => FIELD_KEYS.find(([re]) => re.test(key))?.[1] ?? null;

/**
 * "**Servings** 4", "**Servings:** 4", "**Servings**: 4", "- Servings: 4"
 * → { key: 'servings', value: '4' }. Plain "Key: value" only counts when the
 * key is one we know, so a sentence with a colon isn't mistaken for a field.
 */
const readField = (line) => {
  const bare = line.replace(/^\s*[-*•]\s+/, '');
  const bold = bare.match(/^\*\*([^*]+?)\*\*\s*:?\s*(.*)$/);
  if (bold) {
    const key = bold[1].replace(/:\s*$/, '').trim().toLowerCase();
    return { key, value: bold[2].trim(), bold: true };
  }
  const colon = bare.match(/^([A-Za-z][A-Za-z ]{1,24}):\s*(.+)$/);
  // A long value is prose ("Yield: 8 pancakes (cooked in an 8 inch skillet)…").
  if (colon && colon[2].length <= 40 && fieldFor(colon[1].trim().toLowerCase())) {
    return { key: colon[1].trim().toLowerCase(), value: colon[2].trim(), bold: false };
  }
  return null;
};

/** Which section a heading-ish line starts, or null when it isn't one. */
// Whole-heading matches only: "How to Make Meatballs" is a group of steps,
// not the start of the method.
const SECTIONS = [
  [/^(ingredients?|what you('|’)ll need|you('|’)ll need|shopping list)$/, 'ingredients'],
  [/^(instructions?|directions?|method|steps|preparation|how to make( it)?)$/, 'instructions'],
  [/^(notes?|tips?|chef('|’)s notes?|cook('|’)s notes?)$/, 'notes'],
  [
    /^(nutrition|nutrition facts|nutrition( info| information| per serving)?|nutritional information)$/,
    'nutrition',
  ],
];

/**
 * A heading line — "## Ingredients", "**Ingredients**", "Ingredients:" —
 * → { text, level } or null. `level` is the number of #s (0 for bold/colon).
 */
const readHeading = (line) => {
  const hashes = line.match(/^(#{1,6})\s+(.*)$/);
  if (hashes) return { text: plain(hashes[2]).replace(/:$/, ''), level: hashes[1].length };
  const bold = line.match(/^\*\*([^*]+?):?\*\*:?$/);
  if (bold) return { text: bold[1].trim().replace(/:$/, ''), level: 0 };
  const colon = line.match(/^([A-Za-z][A-Za-z’' ]{2,40}):$/);
  if (colon) return { text: colon[1].trim(), level: 0 };
  return null;
};

const sectionFor = (text) => {
  const lower = String(text ?? '')
    .toLowerCase()
    .replace(/[:.]+$/, '')
    .trim();
  return SECTIONS.find(([re]) => re.test(lower))?.[1] ?? null;
};

/** Drop code-fence lines, so a whole copied chat message still parses. */
const stripFences = (markdown) =>
  String(markdown ?? '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*```/.test(l));

/**
 * Parse one Markdown recipe.
 *
 * @param {string} markdown
 * @returns {object|null} a draft ready for buildRecipeImportDocument, or null
 *   when there is nothing that looks like a title.
 */
export const parseRecipeMarkdown = (markdown) => {
  const lines = stripFences(markdown);

  // Title: the first H1; failing that the first `##`-style heading, then the
  // first **bold** line, that isn't a section name; failing that the first
  // line that isn't a field. Colon lines ("Here's a recipe:") never count.
  const isTitleHeading = (l, test) => {
    const h = readHeading(l.trim());
    return Boolean(h && h.text && !sectionFor(h.text) && test(l.trim()));
  };
  let titleIndex = lines.findIndex((l) => /^#\s+\S/.test(l.trim()));
  if (titleIndex === -1)
    titleIndex = lines.findIndex((l) => isTitleHeading(l, (t) => /^#/.test(t)));
  if (titleIndex === -1)
    titleIndex = lines.findIndex((l) => isTitleHeading(l, (t) => /^\*\*/.test(t)));
  if (titleIndex === -1) {
    // Only above the first section: an ingredient is never the title.
    const firstSection = lines.findIndex((l) => {
      const h = readHeading(l.trim());
      return h && sectionFor(h.text);
    });
    titleIndex = lines.findIndex(
      (l, idx) =>
        (firstSection === -1 || idx < firstSection) &&
        l.trim() &&
        !readField(l.trim()) &&
        !readHeading(l.trim())
    );
  }
  if (titleIndex === -1) return null;

  const rawTitle = lines[titleIndex]
    .trim()
    .replace(/^#+\s+/, '')
    .replace(/^(recipe|title)\s*:\s*/i, '');
  const name = cleanRecipeName(plain(rawTitle).replace(/:$/, ''));
  if (!name || sectionFor(name)) return null;

  const draft = {
    name,
    description: '',
    categories: [],
    cuisines: [],
    tags: [],
    totalTime: null,
    prepTime: null,
    cookTime: null,
    servings: null,
    rating: null,
    source: null,
    difficulty: null,
    ingredients: [],
    instructions: [],
    notes: '',
    nutrition: {},
  };

  const descriptionLines = [];
  const notesLines = [];
  let section = 'header';
  let stepHeading = '';

  const applyField = (field, value) => {
    switch (field) {
      case 'categories':
      case 'cuisines':
      case 'tags':
        draft[field] = [...draft[field], ...splitList(plain(value))];
        break;
      case 'totalTime':
      case 'prepTime':
      case 'cookTime':
        draft[field] = parseDuration(value);
        break;
      case 'servings':
        draft.servings = parseServings(value);
        break;
      case 'rating': {
        const r = Number(String(value).split('/')[0]);
        draft.rating = Number.isFinite(r) && r > 0 ? r : null;
        break;
      }
      case 'source':
        draft.source = plain(value) || null;
        break;
      case 'difficulty': {
        const d = plain(value).toLowerCase();
        draft.difficulty = ['easy', 'medium', 'hard'].includes(d) ? d : null;
        break;
      }
      case 'description':
        descriptionLines.push(plain(value));
        break;
      default:
        break;
    }
  };

  for (const rawLine of lines.slice(titleIndex + 1)) {
    const line = rawLine.trim();
    if (!line) continue;

    // A rule after the recipe usually precedes an assistant's sign-off
    // ("Enjoy! Want a dairy-free version?"), which is not part of it.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      if (section !== 'header') section = 'trailer';
      continue;
    }

    // "Serves 8" / "Makes 12" on its own line, wherever it turns up.
    const servingsLine = line.match(/^(?:serves|makes|yields?)\s*:?\s*(\d[^]{0,24})$/i);
    if (servingsLine && section !== 'header') {
      draft.servings = draft.servings ?? parseServings(servingsLine[1]);
      continue;
    }

    const heading = readHeading(line);
    const headingSection = heading && sectionFor(heading.text);
    // "### Preparation" inside the method is a group of steps, not a new method.
    if (headingSection && !(headingSection === section && section === 'instructions')) {
      section = headingSection;
      stepHeading = '';
      continue;
    }

    const field = section === 'header' || section === 'nutrition' ? readField(line) : null;

    switch (section) {
      case 'header': {
        if (field) {
          const target = fieldFor(field.key);
          if (target && field.value) applyField(target, field.value);
          else if (!field.value && field.bold) descriptionLines.push(field.key);
        } else if (heading && heading.level !== 1) {
          // A sub-heading before any section ("## Overview") — not content.
        } else {
          descriptionLines.push(plain(line));
        }
        break;
      }
      case 'ingredients': {
        if (heading) break; // "### For the dressing:" — grouping only
        const ingredient = parseIngredientLine(line.replace(/^[•–]\s+|^\[[ x]\]\s+/i, '* '));
        if (ingredient) draft.ingredients.push(ingredient);
        break;
      }
      case 'instructions': {
        if (heading) {
          stepHeading = heading.text;
          break;
        }
        const step = line
          .replace(/^(\d+[.)]|[*•–-])\s+/, '')
          .replace(/^\*{0,2}step\s+\d+\s*[:.)-]?\*{0,2}\s*/i, '')
          .replace(/\*{1,3}([^*]+?)\*{1,3}/g, '$1')
          .trim();
        if (!step) break;
        draft.instructions.push(stepHeading ? `${stepHeading}: ${step}` : step);
        stepHeading = '';
        break;
      }
      case 'notes':
        notesLines.push(line.replace(/^[*•-]\s+/, ''));
        break;
      case 'nutrition': {
        const entry = field ?? readNutritionLine(line);
        if (entry && entry.value) {
          const key = entry.key.replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
          draft.nutrition[key] = entry.value;
        }
        break;
      }
      default:
        break;
    }
  }

  draft.description = descriptionLines.join('\n').trim();
  draft.notes = notesLines.join('\n').trim();
  return draft;
};

/** "- Calories: 450" in a nutrition section, where any key is fair game. */
const readNutritionLine = (line) => {
  const m = line.replace(/^\s*[-*•]\s+/, '').match(/^([A-Za-z][A-Za-z ]{1,30}):\s*(.+)$/);
  return m ? { key: m[1].trim().toLowerCase(), value: m[2].trim() } : null;
};

/** Pestle exports are the same Markdown, just more regular. */
export const parsePestleMarkdown = parseRecipeMarkdown;

/**
 * Split a paste that may hold several recipes. Each `# ` heading starts one;
 * anything before the first (an assistant's "Here's your recipe!") is dropped.
 * With no `# ` heading at all, the whole paste is one recipe.
 */
export const splitRecipeText = (text) => {
  const lines = stripFences(text);
  const starts = lines.reduce((acc, l, i) => (/^#\s+\S/.test(l.trim()) ? [...acc, i] : acc), []);
  if (starts.length <= 1) return String(text ?? '').trim() ? [lines.join('\n')] : [];
  return starts.map((start, i) => lines.slice(start, starts[i + 1]).join('\n'));
};

/** "www.example.com" or "https://example.com/x" → a URL; "ChatGPT" → null. */
const asUrl = (value) => {
  const v = String(value ?? '').trim();
  if (!v || /\s/.test(v)) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v) ? `https://${v}` : null;
};

/** Where an import came from: decides the tag and `importedFrom`. */
export const IMPORT_ORIGINS = {
  pestle: { importedFrom: 'pestle', tag: 'pestle' },
  pasted: { importedFrom: 'pasted', tag: null },
};

/**
 * A parsed draft → the `recipes` document the security rules accept, minus the
 * fields the writer stamps (createdAt, createdBy).
 *
 * @param {object} draft
 * @param {'pestle'|'pasted'} origin
 */
export const buildRecipeImportDocument = (draft, origin = 'pestle') => {
  const { importedFrom, tag } = IMPORT_ORIGINS[origin] ?? IMPORT_ORIGINS.pasted;
  const tags = [
    ...new Set(
      [tag, ...draft.categories, ...draft.cuisines, ...(draft.tags ?? [])]
        .filter(Boolean)
        .map((t) => t.toLowerCase())
    ),
  ].sort((a, b) => a.localeCompare(b));

  // Only a total recorded (always the case for Pestle): it goes in cookTime so
  // totalTime() shows it. With prep and cook both given, keep them apart.
  const hasSplit = draft.prepTime != null || draft.cookTime != null;
  const sourceUrl = asUrl(draft.source);

  const doc = {
    name: draft.name,
    ingredients: draft.ingredients.map(({ name, quantity, unit, normalized, text }) => ({
      name,
      quantity,
      unit,
      normalized,
      text,
    })),
    // The library needs at least one step; a few Pestle recipes were saved
    // with none, and losing the recipe would be worse than a placeholder.
    instructions: draft.instructions.length > 0 ? draft.instructions : [MISSING_STEPS_PLACEHOLDER],
    source: 'user-created',
    importedFrom,
    tags,
    servings: draft.servings ?? 1,
    difficulty: draft.difficulty ?? 'easy',
    timesCooked: 0,
    prepTime: hasSplit ? (draft.prepTime ?? null) : null,
    cookTime: hasSplit ? (draft.cookTime ?? null) : (draft.totalTime ?? null),
    imageUrl: null,
    sourceUrl,
  };

  if (!sourceUrl && draft.source) doc.sourceName = draft.source;
  if (draft.description) doc.description = draft.description;
  if (draft.notes) doc.notes = draft.notes;
  if (draft.rating !== null) doc.rating = draft.rating;
  if (Object.keys(draft.nutrition).length > 0) doc.nutrition = draft.nutrition;
  return doc;
};

/** Why a draft can't be imported, or null when it can. */
export const recipeDraftProblem = (draft) => {
  if (!draft) return 'No recipe title found.';
  if (!draft.name) return 'Missing a name.';
  if (draft.ingredients.length === 0) return 'No ingredients.';
  return null;
};

export const MISSING_STEPS_PLACEHOLDER =
  'No steps were saved for this recipe — edit it to add them.';

/** Match key used to spot a recipe that is already in the library. */
export const recipeKey = (name) =>
  cleanRecipeName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Pull the Markdown files out of whatever the cook picked: the export zip, or
 * the .md files themselves.
 *
 * @param {Array<{name: string, bytes: Uint8Array}>} files
 * @returns {Array<{fileName: string, text: string}>}
 */
export const extractMarkdownFiles = (files) => {
  const out = [];
  for (const { name, bytes } of files) {
    if (/\.zip$/i.test(name)) {
      const entries = unzipSync(bytes, {
        filter: (entry) =>
          /\.(md|markdown)$/i.test(entry.name) && !/(^|\/)__MACOSX\//.test(entry.name),
      });
      for (const [entryName, data] of Object.entries(entries)) {
        out.push({ fileName: entryName.split('/').pop(), text: strFromU8(data) });
      }
    } else if (/\.(md|markdown)$/i.test(name)) {
      out.push({ fileName: name, text: strFromU8(bytes) });
    }
  }
  return out;
};

/** Pasted text → the same `{fileName, text}` shape files produce. */
export const pastedTextToFiles = (text) =>
  splitRecipeText(text).map((chunk, i) => ({ fileName: `pasted-${i + 1}`, text: chunk }));

/**
 * Parse every file and sort the results into what will be imported, what is
 * already in the library, and what could not be read.
 *
 * @param {Array<{fileName: string, text: string}>} markdownFiles
 * @param {Array<{name: string}>} existingRecipes - the current library
 * @param {'pestle'|'pasted'} origin
 */
export const planRecipeImport = (markdownFiles, existingRecipes = [], origin = 'pestle') => {
  const seen = new Set(existingRecipes.map((r) => recipeKey(r?.name)));
  const ready = [];
  const duplicates = [];
  const problems = [];

  for (const { fileName, text } of markdownFiles) {
    const draft = parseRecipeMarkdown(text);
    const problem = recipeDraftProblem(draft);
    if (problem) {
      problems.push({ fileName, name: draft?.name || fileName, problem });
      continue;
    }
    const key = recipeKey(draft.name);
    if (seen.has(key)) {
      duplicates.push({ fileName, name: draft.name });
      continue;
    }
    seen.add(key);
    ready.push({
      fileName,
      name: draft.name,
      document: buildRecipeImportDocument(draft, origin),
      missingSteps: draft.instructions.length === 0,
    });
  }

  ready.sort((a, b) => a.name.localeCompare(b.name));
  return { ready, duplicates, problems };
};

/**
 * What to tell ChatGPT or Claude so the recipe it writes pastes straight in.
 * Shown behind a "Copy" button in the import screen.
 */
export const RECIPE_FORMAT_PROMPT = `Write the recipe in this exact Markdown format so I can paste it into my recipe app. Put it in one code block. For several recipes, repeat the format, each starting with its own "# " title line.

# Recipe Name
One or two sentences describing the dish.

**Servings** 4
**Prep Time** 15m
**Cook Time** 30m
**Category** dinner, pasta
**Cuisine** italian
**Difficulty** easy

## Ingredients
* 2 cups all-purpose flour
* 1 tsp salt
* 2 tbsp olive oil (divided)

## Instructions
1. First step.
2. Second step.

## Notes
Optional tips, swaps, or storage advice.

Rules: one ingredient per bullet, starting with the amount and unit (tsp, tbsp, cup, oz, lb, g, ml, clove, can). Use "Difficulty" of easy, medium, or hard. Times like 45m or 1h 10m.`;
