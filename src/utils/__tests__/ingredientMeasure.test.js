import {
  canonicalUnit,
  cleanIngredientName,
  convertQuantity,
  formatAmount,
  formatQuantity,
  ingredientAlternatives,
  ingredientKey,
  measureKey,
} from '../ingredientMeasure';

describe('cleanIngredientName', () => {
  it.each([
    ['Boneless Skinless Chicken Breast, Cut Into Bite-Sized Pieces', 'chicken breast'],
    ['Steak, Such As Sirloin, Strip, Or Ribeye', 'steak'],
    ['Grated Parmesan Cheese', 'parmesan cheese'],
    ['Sharp White Cheddar Cheese, Grated', 'sharp white cheddar cheese'],
    ['Balsamic Glaze, For Serving', 'balsamic glaze'],
    ['Fresh Parsley, Chopped', 'parsley'],
    ['Canned Coconut Milk', 'coconut milk'],
    ['Boneless, skinless chicken thighs', 'chicken thighs'],
    ['salt to taste', 'salt'],
    ['Tomatoes (about 4 medium)', 'tomatoes'],
  ])('%s → %s', (raw, cleaned) => {
    expect(cleanIngredientName(raw)).toBe(cleaned);
  });

  it('keeps a choice intact rather than stripping "fresh" from "fresh or dried"', () => {
    expect(cleanIngredientName('Fresh Or Dried Cranberries')).toBe('fresh or dried cranberries');
  });
});

describe('ingredientKey', () => {
  it('treats singular and plural as one errand', () => {
    expect(ingredientKey('Carrots, Peeled And Chopped')).toBe(ingredientKey('carrot'));
    expect(ingredientKey('Tomatoes')).toBe('tomato');
    expect(ingredientKey('Blueberries')).toBe('blueberry');
    expect(ingredientKey('Peaches')).toBe('peach');
    expect(ingredientKey('asparagus')).toBe('asparagus');
    expect(ingredientKey('Cloves')).toBe('clove');
  });
});

describe('ingredientAlternatives', () => {
  it('spells out each choice in full', () => {
    expect(ingredientAlternatives('vegetable or chicken broth')).toEqual([
      'vegetable broth',
      'chicken broth',
    ]);
    expect(ingredientAlternatives(ingredientKey('Fresh Or Dried Cranberries'))).toEqual([
      'cranberry',
      'dried cranberry',
    ]);
    expect(ingredientAlternatives('chicken broth')).toEqual([]);
  });
});

describe('units', () => {
  it('reads spelled-out and plural units as one unit', () => {
    expect(canonicalUnit('Cups')).toBe('cup');
    expect(canonicalUnit('Tablespoons')).toBe('tbsp');
    expect(canonicalUnit('tsp.')).toBe('tsp');
    expect(canonicalUnit('lbs')).toBe('lb');
    expect(canonicalUnit('cans')).toBe('can');
  });

  it('groups volumes with volumes and weights with weights', () => {
    expect(measureKey('cup')).toBe('volume');
    expect(measureKey('tbsp')).toBe('volume');
    expect(measureKey('oz')).toBe('weight');
    expect(measureKey('g')).toBe('weight');
    expect(measureKey('can')).toBe('can');
    expect(measureKey('')).toBe('count');
  });

  it('converts within a kind and refuses across kinds', () => {
    expect(convertQuantity(1, 'tbsp', 'tsp')).toBe(3);
    expect(convertQuantity(16, 'tbsp', 'cup')).toBe(1);
    expect(convertQuantity(16, 'oz', 'lb')).toBeCloseTo(1);
    expect(convertQuantity(1, 'cup', 'g')).toBeNull();
    expect(convertQuantity(1, 'can', 'clove')).toBeNull();
  });
});

describe('formatting', () => {
  it.each([
    [0.33, '⅓'],
    [1.25, '1¼'],
    [0.5, '½'],
    [2, '2'],
    [2.67, '2⅔'],
    [0.15, '0.15'],
  ])('%s reads as %s', (value, shown) => {
    expect(formatQuantity(value)).toBe(shown);
  });

  it('pluralises spelled units but never abbreviations', () => {
    expect(formatAmount(1.5, 'cup')).toBe('1½ cups');
    expect(formatAmount(0.5, 'cup')).toBe('½ cup');
    expect(formatAmount(5, 'tbsp')).toBe('5 tbsp');
    expect(formatAmount(2, 'can')).toBe('2 cans');
    expect(formatAmount(3, '')).toBe('3');
  });
});
