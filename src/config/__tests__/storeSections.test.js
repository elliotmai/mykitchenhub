// src/config/__tests__/storeSections.test.js

import {
  STORE_SECTIONS,
  INGREDIENT_SECTIONS,
  FALLBACK_SECTION,
  sectionFor,
  groupByStoreSection,
  unfiledIngredients,
} from '../storeSections';

describe('sectionFor', () => {
  it.each([
    ['spinach', 'produce'],
    ['chicken breast', 'meat'],
    ['salmon', 'meat'],
    ['milk', 'dairy'],
    ['eggs', 'dairy'],
    ['bread', 'bakery'],
    ['rice', 'pantry'],
    ['ice cream', 'frozen'],
    ['wine', 'drinks'],
  ])('files %s under %s', (name, expected) => {
    expect(sectionFor(name)).toBe(expected);
  });

  it('is not case or whitespace sensitive — a cook types what they type', () => {
    expect(sectionFor('  SPINACH ')).toBe('produce');
  });

  // The inventory treats singular and plural as one food. If the aisle lookup
  // did not, "egg" and "eggs" would end up in different parts of the list.
  it('treats singular and plural as the same errand', () => {
    expect(sectionFor('egg')).toBe(sectionFor('eggs'));
    expect(sectionFor('carrot')).toBe(sectionFor('carrots'));
  });

  it('falls back on a keyword when the exact name is unknown', () => {
    expect(sectionFor('chicken thighs')).toBe('meat');
    expect(sectionFor('frozen peas')).toBe('frozen');
    expect(sectionFor('sourdough loaf')).toBe('bakery');
    expect(sectionFor('oat milk')).toBe('dairy');
  });

  // "frozen peas" must not file under produce just because it says peas.
  it('lets the more specific keyword win', () => {
    expect(sectionFor('frozen berries')).toBe('frozen');
  });

  it('files something it has never heard of rather than dropping it', () => {
    expect(sectionFor('birthday candles')).toBe(FALLBACK_SECTION);
    expect(sectionFor('')).toBe(FALLBACK_SECTION);
    expect(sectionFor(undefined)).toBe(FALLBACK_SECTION);
  });
});

describe('groupByStoreSection', () => {
  it('returns aisles in the order a shop is walked, not the order given', () => {
    const groups = groupByStoreSection([
      { name: 'ice cream' },
      { name: 'spinach' },
      { name: 'milk' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['produce', 'dairy', 'frozen']);
  });

  it('drops empty aisles rather than printing bare headings', () => {
    const groups = groupByStoreSection([{ name: 'spinach' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Produce');
  });

  it('sorts Other last, so unrecognised items do not head the list', () => {
    const groups = groupByStoreSection([{ name: 'birthday candles' }, { name: 'spinach' }]);
    expect(groups[groups.length - 1].key).toBe(FALLBACK_SECTION);
  });

  it('prefers the normalized name when there is one', () => {
    const groups = groupByStoreSection([{ name: 'Organic Spinach', normalized: 'spinach' }]);
    expect(groups[0].key).toBe('produce');
  });

  it('keeps every item — nothing is lost by grouping', () => {
    const items = [{ name: 'milk' }, { name: 'spinach' }, { name: 'nonsense' }];
    const total = groupByStoreSection(items).reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(items.length);
  });

  it('handles an empty list', () => {
    expect(groupByStoreSection([])).toEqual([]);
  });
});

describe('the map itself', () => {
  it('files every ingredient to a section that exists', () => {
    const known = new Set(STORE_SECTIONS.map((s) => s.key));
    Object.values(INGREDIENT_SECTIONS).forEach((section) => expect(known).toContain(section));
  });

  // The guard against silent drift: add an ingredient to the shelf-life table
  // without filing it here and this fails, naming exactly what is unfiled.
  // Leftovers are excluded there on purpose — they are not bought.
  it('leaves no ingredient from the shelf-life table unfiled', () => {
    expect(unfiledIngredients()).toEqual([]);
  });
});
