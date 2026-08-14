/**
 * The legacy "Let's Eat" data is loose — free-text ingredients, missing
 * servings, no difficulty, sometimes no instructions at all. These tests pin
 * the mapping onto the shape firestore.rules will accept, because a recipe that
 * fails validation on import is a recipe nobody notices is missing.
 */

const {
  normalizeName,
  parseIngredientString,
  parseIngredients,
  parseInstructions,
  transformLegacyRecipe,
} = require('../transformLegacyRecipe');

describe('normalizeName', () => {
  it('lowercases and collapses whitespace so inventory matching lines up', () => {
    expect(normalizeName('  Chicken   BREAST ')).toBe('chicken breast');
  });

  it('survives null without throwing', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('parseIngredientString', () => {
  it.each([
    ['1 cup milk', { name: 'milk', quantity: 1, unit: 'cup' }],
    ['2 cups flour', { name: 'flour', quantity: 2, unit: 'cup' }],
    ['3 cloves garlic', { name: 'garlic', quantity: 3, unit: 'clove' }],
    ['1.5 lbs chicken breast', { name: 'chicken breast', quantity: 1.5, unit: 'lb' }],
  ])('parses "%s"', (input, expected) => {
    expect(parseIngredientString(input)).toEqual(expected);
  });

  it('handles a plain fraction', () => {
    expect(parseIngredientString('1/2 cup sugar')).toEqual({
      name: 'sugar',
      quantity: 0.5,
      unit: 'cup',
    });
  });

  it('handles a mixed number', () => {
    expect(parseIngredientString('1 1/2 cups water')).toEqual({
      name: 'water',
      quantity: 1.5,
      unit: 'cup',
    });
  });

  it('defaults to one of a thing when no amount is written', () => {
    expect(parseIngredientString('salt')).toEqual({ name: 'salt', quantity: 1, unit: '' });
  });

  it('drops a leading article', () => {
    expect(parseIngredientString('1 cup of milk').name).toBe('milk');
  });

  it('does not mistake a word inside the name for a unit', () => {
    // "gram" appears inside "graham"; only a standalone leading word is a unit.
    expect(parseIngredientString('2 graham crackers')).toEqual({
      name: 'graham crackers',
      quantity: 2,
      unit: '',
    });
  });

  it('keeps the original text when there is nothing but an amount', () => {
    expect(parseIngredientString('3').name).toBe('3');
  });
});

describe('parseIngredients', () => {
  it('normalizes structured ingredients', () => {
    expect(parseIngredients([{ name: 'Salmon', quantity: 2, unit: 'fillet' }])).toEqual([
      { name: 'Salmon', quantity: 2, unit: 'fillet', normalized: 'salmon' },
    ]);
  });

  it('accepts the legacy `amount` and `item` spellings', () => {
    expect(parseIngredients([{ item: 'Rice', amount: '3' }])).toEqual([
      { name: 'Rice', quantity: 3, unit: '', normalized: 'rice' },
    ]);
  });

  it('parses free-text ingredients', () => {
    expect(parseIngredients(['2 cups rice'])).toEqual([
      { name: 'rice', quantity: 2, unit: 'cup', normalized: 'rice' },
    ]);
  });

  it('handles a mixed list', () => {
    const parsed = parseIngredients(['1 cup milk', { name: 'Eggs', quantity: 3 }]);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((i) => i.normalized)).toEqual(['milk', 'eggs']);
  });

  it('drops entries with no usable name', () => {
    expect(parseIngredients(['', null, {}, { name: '   ' }])).toEqual([]);
  });

  it('returns an empty list rather than throwing on junk', () => {
    expect(parseIngredients(null)).toEqual([]);
    expect(parseIngredients('not an array')).toEqual([]);
  });

  it('never emits a zero or negative quantity — the rules reject those', () => {
    const parsed = parseIngredients([{ name: 'salt', quantity: 0 }, { name: 'pepper', quantity: -1 }]);
    parsed.forEach((i) => expect(i.quantity).toBeGreaterThan(0));
  });
});

describe('parseInstructions', () => {
  it('keeps an array of steps', () => {
    expect(parseInstructions(['Boil water.', 'Add pasta.'])).toEqual(['Boil water.', 'Add pasta.']);
  });

  it('splits a text blob on line breaks', () => {
    expect(parseInstructions('Boil water.\n\nAdd pasta.')).toEqual(['Boil water.', 'Add pasta.']);
  });

  it('returns nothing for a recipe with no instructions', () => {
    expect(parseInstructions(undefined)).toEqual([]);
    expect(parseInstructions('')).toEqual([]);
  });
});

describe('transformLegacyRecipe', () => {
  const legacy = {
    name: 'Grandma Chili',
    ingredients: ['2 lbs ground beef', '1 can tomatoes'],
    tags: ['Dinner', 'comfort'],
  };

  it('produces every field the security rules require on create', () => {
    const recipe = transformLegacyRecipe(legacy, 'legacy-1');

    ['name', 'ingredients', 'instructions', 'source', 'createdAt', 'tags', 'servings', 'difficulty', 'timesCooked'].forEach(
      (field) => expect(recipe).toHaveProperty(field)
    );
  });

  it('marks the recipe as legacy and keeps the id for de-duplication', () => {
    const recipe = transformLegacyRecipe(legacy, 'legacy-1');

    expect(recipe.source).toBe('legacy');
    expect(recipe.legacyId).toBe('legacy-1');
  });

  it('tags every imported recipe as legacy, keeping the original tags', () => {
    const recipe = transformLegacyRecipe(legacy, 'legacy-1');

    expect(recipe.tags).toEqual(expect.arrayContaining(['dinner', 'comfort', 'legacy']));
  });

  it('does not duplicate a legacy tag the recipe already had', () => {
    const recipe = transformLegacyRecipe({ ...legacy, tags: ['legacy'] }, 'legacy-1');

    expect(recipe.tags.filter((t) => t === 'legacy')).toHaveLength(1);
  });

  it('fills in the fields the legacy app never had', () => {
    const recipe = transformLegacyRecipe(legacy, 'legacy-1');

    expect(recipe.servings).toBeGreaterThan(0);
    expect(['easy', 'medium', 'hard']).toContain(recipe.difficulty);
    expect(recipe.timesCooked).toBe(0);
  });

  it('keeps servings and difficulty when the legacy recipe had them', () => {
    const recipe = transformLegacyRecipe({ ...legacy, servings: 6, difficulty: 'hard' }, 'x');

    expect(recipe.servings).toBe(6);
    expect(recipe.difficulty).toBe('hard');
  });

  it('rejects a difficulty the rules would not accept', () => {
    const recipe = transformLegacyRecipe({ ...legacy, difficulty: 'impossible' }, 'x');

    expect(recipe.difficulty).toBe('medium');
  });

  it('names an untitled recipe rather than writing an empty name', () => {
    expect(transformLegacyRecipe({}, 'x').name).toBe('Untitled Recipe');
  });

  it('accepts a `title` from an older legacy export', () => {
    expect(transformLegacyRecipe({ title: 'Old Shape' }, 'x').name).toBe('Old Shape');
  });

  it('stamps the supplied creation time', () => {
    const recipe = transformLegacyRecipe(legacy, 'x', { createdAt: '2026-01-01T00:00:00.000Z' });

    expect(recipe.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('leaves instructions empty when the legacy recipe had none, for the sync to fill', () => {
    expect(transformLegacyRecipe(legacy, 'x').instructions).toEqual([]);
  });
});
