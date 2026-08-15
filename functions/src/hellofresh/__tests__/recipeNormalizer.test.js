/**
 * The normaliser is the only thing standing between a messy recipe card and a
 * document the `recipes` security rules will accept. Every case here is one the
 * rules would reject, or one that would silently break inventory matching.
 */

const {
  inferDifficulty,
  normalizeIngredient,
  normalizeIngredientName,
  normalizeInstructions,
  normalizeRecipe,
  normalizeServings,
  normalizeTags,
  normalizeUnit,
  parseQuantity,
} = require('../recipeNormalizer');

describe('parseQuantity', () => {
  it.each([
    ['2 cloves garlic', 2],
    ['1.5 cups flour', 1.5],
    ['1/2 lemon', 0.5],
    ['1 1/2 tbsp butter', 1.5],
    ['½ tsp salt', 0.5],
    ['1½ cups milk', 1.5],
  ])('reads the amount out of "%s"', (input, expected) => {
    expect(parseQuantity(input).quantity).toBeCloseTo(expected, 4);
  });

  it('defaults to one when the card gives no number', () => {
    expect(parseQuantity('Salt, to taste')).toEqual({ quantity: 1, rest: 'Salt, to taste' });
  });

  it('does not divide by zero on a malformed fraction', () => {
    expect(parseQuantity('1/0 lemon').quantity).toBe(1);
  });

  it('survives empty and missing input', () => {
    expect(parseQuantity('').quantity).toBe(1);
    expect(parseQuantity(undefined).quantity).toBe(1);
  });
});

describe('normalizeUnit', () => {
  it.each([
    ['tablespoons', 'tbsp'],
    ['Tbsp.', 'tbsp'],
    ['teaspoon', 'tsp'],
    ['ounces', 'oz'],
    ['pounds', 'lb'],
    ['grams', 'g'],
    ['cloves', 'clove'],
    ['pieces', 'unit'],
  ])('maps "%s" to "%s"', (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected);
  });

  it('keeps a HelloFresh-specific unit rather than flattening it', () => {
    expect(normalizeUnit('sachet')).toBe('sachet');
  });

  it('returns an empty string when there is no unit', () => {
    expect(normalizeUnit('')).toBe('');
    expect(normalizeUnit(null)).toBe('');
  });
});

describe('normalizeIngredientName', () => {
  it('strips parentheticals and punctuation so inventory matching works', () => {
    expect(normalizeIngredientName('Tomato Paste (divided)')).toBe('tomato paste');
    expect(normalizeIngredientName('Chicken Breast, boneless')).toBe('chicken breast boneless');
  });
});

describe('normalizeIngredient', () => {
  it('splits a plain card line into name, quantity, and unit', () => {
    expect(normalizeIngredient('2 cloves Garlic')).toEqual({
      name: 'Garlic',
      quantity: 2,
      unit: 'clove',
      normalized: 'garlic',
    });
  });

  it('splits a unit glued to its number, as HelloFresh prints them', () => {
    expect(normalizeIngredient('28g Tomato Paste')).toEqual({
      name: 'Tomato Paste',
      quantity: 28,
      unit: 'g',
      normalized: 'tomato paste',
    });
  });

  it('keeps a structured ingredient the vision model already split up', () => {
    expect(normalizeIngredient({ name: 'Chicken Breast', quantity: 2, unit: 'pounds' })).toEqual({
      name: 'Chicken Breast',
      quantity: 2,
      unit: 'lb',
      normalized: 'chicken breast',
    });
  });

  it('recovers when the model puts the whole line in `name`', () => {
    expect(normalizeIngredient({ name: '2 tbsp Olive Oil', quantity: 0, unit: '' })).toEqual({
      name: 'Olive Oil',
      quantity: 2,
      unit: 'tbsp',
      normalized: 'olive oil',
    });
  });

  it('drops a leading "of" left behind by the unit', () => {
    expect(normalizeIngredient('1 cup of Basmati Rice').name).toBe('Basmati Rice');
  });

  it('returns null for entries with nothing usable in them', () => {
    expect(normalizeIngredient('')).toBeNull();
    expect(normalizeIngredient(null)).toBeNull();
    expect(normalizeIngredient({ name: '   ' })).toBeNull();
  });

  it('never emits a zero or negative quantity — the rules reject those', () => {
    expect(normalizeIngredient({ name: 'Salt', quantity: 0, unit: 'tsp' }).quantity).toBe(1);
    expect(normalizeIngredient({ name: 'Salt', quantity: -3, unit: 'tsp' }).quantity).toBe(1);
  });
});

describe('normalizeInstructions', () => {
  it('keeps a list of steps as-is', () => {
    expect(normalizeInstructions(['Preheat oven.', 'Roast 15 minutes.'])).toEqual([
      'Preheat oven.',
      'Roast 15 minutes.',
    ]);
  });

  it('splits a numbered blob on the numbering, not on every period', () => {
    expect(normalizeInstructions('1. Preheat to 400F. Wash the veg. 2. Roast 15 min.')).toEqual([
      'Preheat to 400F. Wash the veg.',
      'Roast 15 min.',
    ]);
  });

  it('splits an unnumbered blob on line breaks', () => {
    expect(normalizeInstructions('Chop the onion\nFry it gently')).toEqual([
      'Chop the onion',
      'Fry it gently',
    ]);
  });

  it('unwraps schema.org HowToStep objects', () => {
    expect(normalizeInstructions([{ text: 'Boil water.' }, { text: 'Add pasta.' }])).toEqual([
      'Boil water.',
      'Add pasta.',
    ]);
  });

  it('returns an empty list for nothing', () => {
    expect(normalizeInstructions(undefined)).toEqual([]);
    expect(normalizeInstructions('   ')).toEqual([]);
  });
});

describe('inferDifficulty', () => {
  it.each([
    [5, 10, 'easy'],
    [10, 15, 'easy'],
    [15, 25, 'medium'],
    [20, 30, 'medium'],
    [30, 45, 'hard'],
  ])('grades %i min prep + %i min cook as %s', (prep, cook, expected) => {
    expect(inferDifficulty(prep, cook)).toBe(expected);
  });

  it('falls back to easy when the card gave no timings', () => {
    expect(inferDifficulty(null, null)).toBe('easy');
  });
});

describe('normalizeServings', () => {
  it('rounds to a whole number of portions', () => {
    expect(normalizeServings(4.4)).toBe(4);
  });

  it('falls back to a HelloFresh box of two when the value is unusable', () => {
    // The rules require servings > 0, so this can never pass through as-is.
    expect(normalizeServings(0)).toBe(2);
    expect(normalizeServings(-1)).toBe(2);
    expect(normalizeServings('lots')).toBe(2);
    expect(normalizeServings(undefined)).toBe(2);
  });
});

describe('normalizeTags', () => {
  it('slugifies, lowercases, and de-duplicates', () => {
    expect(normalizeTags(['Quick Dinner', 'quick-dinner', 'Spicy!'])).toEqual([
      'quick-dinner',
      'spicy',
    ]);
  });

  it('splits a comma-separated string', () => {
    expect(normalizeTags('chicken, one pan')).toEqual(['chicken', 'one-pan']);
  });

  it('returns an empty list rather than undefined — the rules require the key', () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe('normalizeRecipe', () => {
  const card = {
    name: 'Sweet Chili Chicken',
    servings: 2,
    prepTime: 10,
    cookTime: 25,
    tags: ['chicken'],
    ingredients: ['2 Chicken Breasts', '28g Tomato Paste', '1 tbsp Olive Oil'],
    instructions: ['Preheat oven to 425F.', 'Roast the chicken 20 minutes.'],
  };

  it('produces every field the recipes rules require on create', () => {
    const { recipe } = normalizeRecipe(card);

    // Mirrors hasRequiredFields([...]) in firestore/firestore.rules.
    ['name', 'ingredients', 'instructions', 'source', 'tags', 'servings', 'difficulty', 'timesCooked'].forEach(
      (field) => expect(recipe).toHaveProperty(field)
    );

    expect(recipe.source).toBe('hellofresh');
    expect(recipe.difficulty).toBe('medium');
    expect(recipe.servings).toBeGreaterThan(0);
    expect(recipe.timesCooked).toBe(0);
  });

  it('leaves createdAt unset so the client stamps it under its own credentials', () => {
    const { recipe } = normalizeRecipe(card);
    expect(recipe).not.toHaveProperty('createdAt');
  });

  it('tags every import so the recipe list can filter to HelloFresh', () => {
    expect(normalizeRecipe(card).recipe.tags).toContain('hellofresh');
  });

  it('does not tag it twice when the source already said hellofresh', () => {
    const { recipe } = normalizeRecipe({ ...card, tags: ['HelloFresh', 'chicken'] });
    expect(recipe.tags.filter((tag) => tag === 'hellofresh')).toHaveLength(1);
  });

  it('normalises every ingredient for inventory matching', () => {
    const { recipe } = normalizeRecipe(card);
    expect(recipe.ingredients).toHaveLength(3);
    recipe.ingredients.forEach((ingredient) => {
      expect(ingredient.normalized).toBe(ingredient.name.toLowerCase());
      expect(ingredient.quantity).toBeGreaterThan(0);
    });
  });

  it('honours an explicit difficulty from the source', () => {
    expect(normalizeRecipe({ ...card, difficulty: 'HARD' }).recipe.difficulty).toBe('hard');
  });

  it('ignores a difficulty the rules would reject', () => {
    expect(normalizeRecipe({ ...card, difficulty: 'impossible' }).recipe.difficulty).toBe('medium');
  });

  it('warns instead of inventing content when the card was unreadable', () => {
    const { recipe, warnings } = normalizeRecipe({ name: '', ingredients: [], instructions: '' });

    expect(warnings).toHaveLength(3);
    expect(warnings.join(' ')).toMatch(/name/i);
    expect(warnings.join(' ')).toMatch(/ingredients/i);
    expect(warnings.join(' ')).toMatch(/steps/i);
    // Still a valid document shape, so the review form has something to edit.
    expect(recipe.name).toBe('Untitled HelloFresh Recipe');
    expect(recipe.ingredients).toEqual([]);
  });

  it('passes the model\'s own warnings through to the cook', () => {
    const { warnings } = normalizeRecipe({ ...card, warnings: ['Step 3 was cut off.'] });
    expect(warnings).toContain('Step 3 was cut off.');
  });

  it('records where the recipe came from', () => {
    const { recipe } = normalizeRecipe(card, {
      sourceUrl: 'https://www.hellofresh.com/recipes/x-123',
      imageUrl: 'https://img.hellofresh.com/x.jpg',
    });
    expect(recipe.sourceUrl).toBe('https://www.hellofresh.com/recipes/x-123');
    expect(recipe.imageUrl).toBe('https://img.hellofresh.com/x.jpg');
  });

  it('handles being called with nothing at all', () => {
    const { recipe } = normalizeRecipe();
    expect(recipe.source).toBe('hellofresh');
    expect(recipe.servings).toBe(2);
  });
});
