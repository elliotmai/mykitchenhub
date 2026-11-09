// pestleImport — turning Pestle's Markdown export into library documents.
// The fixtures below are trimmed copies of real files from a Pestle export.

import { strToU8, zipSync } from 'fflate';

import {
  buildPestleDocument,
  cleanRecipeName,
  extractMarkdownFiles,
  MISSING_STEPS_PLACEHOLDER,
  parseAmount,
  parseDuration,
  parseIngredientLine,
  parsePestleMarkdown,
  parseServings,
  planPestleImport,
  recipeKey,
} from '../pestleImport';

const MISO = `# Miso Soup



**Category** snack, dinner, soup

**Cuisine** japanese, asia

**Servings** Serves 2

**Rating** 3.6/5

**Source** www.thekitchn.com

## Ingredients

* 2 cups water
* ½ cup loosely packed dried bonito flakes (katsuobushi), optional
* 1 medium scallions
* 2 tbsp red or white miso paste

## Instructions

1. Make the dashi.
2. Add the tofu.

##  Nutrition

**Serving Size** Serves 2

**Calories** 122 cal

**Saturated Fat** 0.9 g
`;

const HELLOFRESH = `# 2025 W48 R207 Chicken & Miso Pan Sauce with Charred Broccoli

For this light, satisfying meal, we drape a juicy chicken cutlet in miso sauce.

**Category** north america

**Cuisine** north america

**Total Time** 1h 10m

**Servings** 2.0

**Source** www.hellofresh.com

## Ingredients

* 1 unit Mini Cucumber
* 10 oz Chicken Cutlets
* Salt
*

## Instructions

### Prep:
1. Wash and dry produce.
2. Heat a drizzle of oil.

## Notes

Poultry is fully cooked at 165°.
Rest before slicing.
`;

const BLINI = `# Blini

**Cuisine** russian

## Ingredients

* 2 cups milk
* 2 eggs

## Instructions
`;

describe('parseAmount', () => {
  it.each([
    ['2', 2],
    ['1.5', 1.5],
    ['½', 0.5],
    ['1½', 1.5],
    ['1 ½', 1.5],
    ['1 1/2', 1.5],
    ['3⁄4', 0.75],
    ['⅓', 0.333],
  ])('%s → %s', (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each(['', 'a', '0', '1/0', null])('rejects %p', (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});

describe('parseIngredientLine', () => {
  it.each([
    ['* 2 tbsp red miso paste', 2, 'tbsp', 'red miso paste', 'red miso paste'],
    ['* ½ cup water', 0.5, 'cup', 'water', 'water'],
    ['* 1½ Tablespoons sugar', 1.5, 'tbsp', 'sugar', 'sugar'],
    ['* 1 unit Mini Cucumber', 1, '', 'Mini Cucumber', 'mini cucumber'],
    ['* 1 large egg', 1, '', 'large egg', 'large egg'],
    ['* 2-3 cloves garlic', 2, 'cloves', 'garlic', 'garlic'],
    ['* 5 cloves', 5, '', 'cloves', 'cloves'],
    ['* 300g pasta shapes', 300, 'g', 'pasta shapes', 'pasta shapes'],
    [
      '* 80g / 2.8oz Unsalted Butter, softened',
      80,
      'g',
      'Unsalted Butter, softened',
      'unsalted butter softened',
    ],
    ['* 60mL / 1/4 cup Dry White Wine', 60, 'ml', 'Dry White Wine', 'dry white wine'],
    [
      '* 2x 250g/9oz Chicken Breasts',
      2,
      '',
      '250g/9oz Chicken Breasts',
      '250g 9oz chicken breasts',
    ],
    ['* Salt', 1, '', 'Salt', 'salt'],
  ])('%s', (line, quantity, unit, name, normalized) => {
    expect(parseIngredientLine(line)).toMatchObject({ quantity, unit, name, normalized });
  });

  it('tidies Pestle’s doubled parentheses and keeps the original line', () => {
    expect(parseIngredientLine('* 2 lbs russet potatoes ((5 medium), peeled)')).toEqual({
      name: 'russet potatoes (5 medium, peeled)',
      quantity: 2,
      unit: 'lbs',
      normalized: 'russet potatoes',
      text: '2 lbs russet potatoes ((5 medium), peeled)',
    });
  });

  it('skips empty bullets', () => {
    expect(parseIngredientLine('*')).toBeNull();
    expect(parseIngredientLine('')).toBeNull();
  });
});

describe('small field parsers', () => {
  it.each([
    ['30m', 30],
    ['1h 10m', 70],
    ['2h', 120],
    ['45', 45],
    ['soon', null],
  ])('parseDuration(%p) → %p', (raw, expected) => expect(parseDuration(raw)).toBe(expected));

  it.each([
    ['2.0', 2],
    ['Serves 2', 2],
    ['4-6', 4],
    ['some', null],
  ])('parseServings(%p) → %p', (raw, expected) => expect(parseServings(raw)).toBe(expected));

  it('drops the HelloFresh week code from names', () => {
    expect(cleanRecipeName('2025 W48 R141 Spicy Soup')).toBe('Spicy Soup');
    expect(cleanRecipeName('[SIDE SWAP] Meatloaf')).toBe('[SIDE SWAP] Meatloaf');
  });

  it('matches names regardless of case and punctuation', () => {
    expect(recipeKey('Chicken & Rice!')).toBe(recipeKey('chicken rice'));
  });
});

describe('parsePestleMarkdown', () => {
  it('reads the header fields, ingredients, steps and nutrition', () => {
    const draft = parsePestleMarkdown(MISO);
    expect(draft).toMatchObject({
      name: 'Miso Soup',
      categories: ['snack', 'dinner', 'soup'],
      cuisines: ['japanese', 'asia'],
      servings: 2,
      rating: 3.6,
      sourceSite: 'www.thekitchn.com',
      totalTime: null,
      instructions: ['Make the dashi.', 'Add the tofu.'],
      nutrition: { servingSize: 'Serves 2', calories: '122 cal', saturatedFat: '0.9 g' },
    });
    expect(draft.ingredients).toHaveLength(4);
  });

  it('keeps the description, notes and step headings', () => {
    const draft = parsePestleMarkdown(HELLOFRESH);
    expect(draft.name).toBe('Chicken & Miso Pan Sauce with Charred Broccoli');
    expect(draft.description).toMatch(/^For this light/);
    expect(draft.totalTime).toBe(70);
    expect(draft.instructions).toEqual(['Prep: Wash and dry produce.', 'Heat a drizzle of oil.']);
    expect(draft.notes).toBe('Poultry is fully cooked at 165°.\nRest before slicing.');
    expect(draft.ingredients.map((i) => i.name)).toEqual([
      'Mini Cucumber',
      'Chicken Cutlets',
      'Salt',
    ]);
  });

  it('returns null without a title', () => {
    expect(parsePestleMarkdown('just text')).toBeNull();
  });
});

describe('buildPestleDocument', () => {
  it('produces a document the recipes rules accept', () => {
    const doc = buildPestleDocument(parsePestleMarkdown(HELLOFRESH));
    expect(doc).toMatchObject({
      name: 'Chicken & Miso Pan Sauce with Charred Broccoli',
      source: 'user-created',
      importedFrom: 'pestle',
      tags: ['north america', 'pestle'],
      servings: 2,
      difficulty: 'easy',
      timesCooked: 0,
      prepTime: null,
      cookTime: 70,
      sourceUrl: 'https://www.hellofresh.com',
      notes: expect.stringMatching(/165/),
    });
    expect(doc).not.toHaveProperty('rating');
    expect(doc.ingredients.every((i) => i.quantity > 0)).toBe(true);
  });

  it('gives a recipe with no saved steps a placeholder', () => {
    const doc = buildPestleDocument(parsePestleMarkdown(BLINI));
    expect(doc.instructions).toEqual([MISSING_STEPS_PLACEHOLDER]);
    expect(doc.servings).toBe(1);
    expect(doc.sourceUrl).toBeNull();
  });
});

describe('extractMarkdownFiles', () => {
  it('reads recipes out of the export zip and ignores everything else', () => {
    const zip = zipSync({
      'Miso Soup.md': strToU8(MISO),
      'export/Blini.md': strToU8(BLINI),
      '__MACOSX/._Miso Soup.md': strToU8('junk'),
      'cover.jpg': new Uint8Array([1, 2, 3]),
    });
    const files = extractMarkdownFiles([{ name: 'Export.zip', bytes: zip }]);
    expect(files.map((f) => f.fileName).sort()).toEqual(['Blini.md', 'Miso Soup.md']);
  });

  it('accepts loose .md files', () => {
    const files = extractMarkdownFiles([
      { name: 'Miso Soup.md', bytes: strToU8(MISO) },
      { name: 'notes.txt', bytes: strToU8('x') },
    ]);
    expect(files).toEqual([{ fileName: 'Miso Soup.md', text: MISO }]);
  });
});

describe('planPestleImport', () => {
  const files = [
    { fileName: 'Miso Soup.md', text: MISO },
    { fileName: 'Miso copy.md', text: MISO },
    { fileName: 'HF.md', text: HELLOFRESH },
    { fileName: 'Blini.md', text: BLINI },
    { fileName: 'bad.md', text: 'no title here' },
    { fileName: 'empty.md', text: '# Nothing\n\n## Ingredients\n\n## Instructions\n1. Stir.' },
  ];

  it('sorts files into ready, duplicate and unreadable', () => {
    const plan = planPestleImport(files, [
      { name: 'chicken & miso pan sauce with charred broccoli' },
    ]);
    expect(plan.ready.map((r) => r.name)).toEqual(['Blini', 'Miso Soup']);
    expect(plan.ready.find((r) => r.name === 'Blini').missingSteps).toBe(true);
    expect(plan.duplicates.map((d) => d.fileName)).toEqual(['Miso copy.md', 'HF.md']);
    expect(plan.problems).toEqual([
      { fileName: 'bad.md', name: 'bad.md', problem: 'No recipe title found.' },
      { fileName: 'empty.md', name: 'Nothing', problem: 'No ingredients.' },
    ]);
  });

  it('works without a library', () => {
    expect(planPestleImport(files).ready).toHaveLength(3);
  });
});
