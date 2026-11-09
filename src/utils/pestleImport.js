// src/utils/pestleImport.js
// Turns a Pestle recipe export into recipe drafts for the shared library.
//
// Pestle's "Export all" produces a zip with one Markdown file per recipe:
//
//   # Name
//   <optional description>
//   **Category** dinner, soup        **Cuisine** japanese
//   **Total Time** 1h 10m            **Servings** 4.0 | Serves 2
//   **Rating** 4.5/5                 **Source** www.example.com
//   ## Ingredients   (* bullets, optional ### section headings)
//   ## Instructions  (1. numbered steps, optional ### section headings)
//   ## Notes         (free text, optional)
//   ## Nutrition     (**Field** value, optional)
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
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

const FIELD_RE = /^\*\*([^*]+)\*\*\s*(.*)$/;

/**
 * Parse one Pestle Markdown recipe.
 *
 * @param {string} markdown
 * @returns {object|null} a draft ready for buildPestleDocument, or null when
 *   the text has no `# Title`.
 */
export const parsePestleMarkdown = (markdown) => {
  const lines = String(markdown ?? '')
    .replace(/^﻿/, '')
    .split(/\r?\n/);

  const titleIndex = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (titleIndex === -1) return null;

  const draft = {
    name: cleanRecipeName(lines[titleIndex].replace(/^#\s+/, '')),
    description: '',
    categories: [],
    cuisines: [],
    totalTime: null,
    servings: null,
    rating: null,
    sourceSite: null,
    ingredients: [],
    instructions: [],
    notes: '',
    nutrition: {},
  };

  const descriptionLines = [];
  const notesLines = [];
  let section = 'header';
  let stepHeading = '';

  for (const rawLine of lines.slice(titleIndex + 1)) {
    const line = rawLine.trim();

    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      const heading = h2[1].trim().toLowerCase();
      if (heading.startsWith('ingredient')) section = 'ingredients';
      else if (heading.startsWith('instruction') || heading.startsWith('direction'))
        section = 'instructions';
      else if (heading.startsWith('note')) section = 'notes';
      else if (heading.startsWith('nutrition')) section = 'nutrition';
      else section = 'other';
      stepHeading = '';
      continue;
    }
    if (!line) continue;

    const field = line.match(FIELD_RE);

    switch (section) {
      case 'header': {
        if (field) {
          const key = field[1].trim().toLowerCase();
          const value = field[2].trim();
          if (key === 'category') draft.categories = splitList(value);
          else if (key === 'cuisine') draft.cuisines = splitList(value);
          else if (key === 'total time') draft.totalTime = parseDuration(value);
          else if (key === 'servings') draft.servings = parseServings(value);
          else if (key === 'source') draft.sourceSite = value || null;
          else if (key === 'rating') {
            const r = Number(value.split('/')[0]);
            draft.rating = Number.isFinite(r) && r > 0 ? r : null;
          } else if (!value) descriptionLines.push(field[1].trim());
        } else {
          descriptionLines.push(line);
        }
        break;
      }
      case 'ingredients': {
        if (/^#{3,}\s/.test(line)) break; // "### For the dressing:" — grouping only
        const ingredient = parseIngredientLine(line);
        if (ingredient) draft.ingredients.push(ingredient);
        break;
      }
      case 'instructions': {
        const h3 = line.match(/^#{3,}\s+(.*)$/);
        if (h3) {
          stepHeading = h3[1].trim().replace(/:$/, '');
          break;
        }
        const step = line.replace(/^(\d+[.)]|[*-])\s+/, '').trim();
        if (!step) break;
        draft.instructions.push(stepHeading ? `${stepHeading}: ${step}` : step);
        stepHeading = '';
        break;
      }
      case 'notes':
        notesLines.push(line.replace(/^[*-]\s+/, ''));
        break;
      case 'nutrition': {
        if (field && field[2].trim()) {
          const key = field[1]
            .trim()
            .toLowerCase()
            .replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
          draft.nutrition[key] = field[2].trim();
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

/**
 * A parsed draft → the `recipes` document the security rules accept, minus the
 * fields the writer stamps (createdAt, createdBy).
 */
export const buildPestleDocument = (draft) => {
  const tags = [
    ...new Set(['pestle', ...draft.categories, ...draft.cuisines].map((t) => t.toLowerCase())),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

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
    importedFrom: 'pestle',
    tags,
    servings: draft.servings ?? 1,
    difficulty: 'easy',
    timesCooked: 0,
    prepTime: null,
    // Pestle only records a total; it goes in cookTime so totalTime() shows it.
    cookTime: draft.totalTime ?? null,
    imageUrl: null,
    sourceUrl: draft.sourceSite ? `https://${draft.sourceSite.replace(/^https?:\/\//, '')}` : null,
  };

  if (draft.description) doc.description = draft.description;
  if (draft.notes) doc.notes = draft.notes;
  if (draft.rating !== null) doc.rating = draft.rating;
  if (Object.keys(draft.nutrition).length > 0) doc.nutrition = draft.nutrition;
  return doc;
};

/** Why a draft can't be imported, or null when it can. */
export const pestleDraftProblem = (draft) => {
  if (!draft) return 'No recipe title found.';
  if (!draft.name) return 'Missing a name.';
  if (draft.ingredients.length === 0) return 'No ingredients.';
  return null;
};

export const MISSING_STEPS_PLACEHOLDER =
  'No steps were saved for this recipe in Pestle — edit it to add them.';

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

/**
 * Parse every file and sort the results into what will be imported, what is
 * already in the library, and what could not be read.
 *
 * @param {Array<{fileName: string, text: string}>} markdownFiles
 * @param {Array<{name: string}>} existingRecipes - the current library
 */
export const planPestleImport = (markdownFiles, existingRecipes = []) => {
  const seen = new Set(existingRecipes.map((r) => recipeKey(r?.name)));
  const ready = [];
  const duplicates = [];
  const problems = [];

  for (const { fileName, text } of markdownFiles) {
    const draft = parsePestleMarkdown(text);
    const problem = pestleDraftProblem(draft);
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
      document: buildPestleDocument(draft),
      missingSteps: draft.instructions.length === 0,
    });
  }

  ready.sort((a, b) => a.name.localeCompare(b.name));
  return { ready, duplicates, problems };
};
