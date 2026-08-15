// Shelf-life lookup feeds every expiration date the app calculates, so the
// table's shape matters as much as the lookup logic.

import { renderHook } from '@testing-library/react';
import { useIngredientMetadata, useIngredientAutocomplete } from '../useIngredientMetadata';

const meta = () => renderHook(() => useIngredientMetadata()).result.current;

describe('getShelfLife', () => {
  it('returns the table value for a known ingredient', () => {
    const { getShelfLife } = meta();
    expect(getShelfLife('milk', 'fridge')).toBe(7);
    expect(getShelfLife('milk', 'freezer')).toBe(90);
  });

  it('is case- and whitespace-insensitive', () => {
    const { getShelfLife } = meta();
    expect(getShelfLife('  MILK  ', 'fridge')).toBe(7);
  });

  it('returns null when an ingredient does not belong in a location', () => {
    const { getShelfLife } = meta();
    expect(getShelfLife('milk', 'pantry')).toBeNull();
    expect(getShelfLife('lettuce', 'freezer')).toBeNull();
  });

  it('falls back to per-location defaults for unknown ingredients', () => {
    const { getShelfLife } = meta();
    expect(getShelfLife('dragonfruit', 'fridge')).toBe(7);
    expect(getShelfLife('dragonfruit', 'freezer')).toBe(90);
    expect(getShelfLife('dragonfruit', 'pantry')).toBe(30);
  });
});

describe('calculateExpirationDate', () => {
  it('adds the shelf life to the purchase date', () => {
    const { calculateExpirationDate } = meta();
    const purchased = new Date('2026-03-01T12:00:00Z');
    const expires = calculateExpirationDate('milk', 'fridge', purchased);

    // Calendar days, not milliseconds: a shelf life spanning a daylight-saving
    // change is still seven days, and is an hour short of 7 × 86400000.
    expect(Math.round((expires - purchased) / 86400000)).toBe(7);
    expect(expires.getHours()).toBe(purchased.getHours());
  });

  it('does not mutate the purchase date it was given', () => {
    const { calculateExpirationDate } = meta();
    const purchased = new Date('2026-03-01T12:00:00Z');
    calculateExpirationDate('milk', 'fridge', purchased);

    expect(purchased.toISOString()).toBe('2026-03-01T12:00:00.000Z');
  });

  it('returns null for an ingredient that cannot live in that location', () => {
    const { calculateExpirationDate } = meta();
    expect(calculateExpirationDate('milk', 'pantry')).toBeNull();
  });
});

describe('ingredient search', () => {
  it('lists ingredients alphabetically', () => {
    const { getAllIngredients } = meta();
    const all = getAllIngredients();

    expect(all.length).toBeGreaterThan(20);
    expect(all).toEqual([...all].sort());
  });

  it('matches on substrings', () => {
    const { searchIngredients } = meta();
    expect(searchIngredients('cheese')).toEqual(
      expect.arrayContaining(['cheese', 'cottage cheese', 'cream cheese'])
    );
  });

  it('returns nothing for a term that matches no ingredient', () => {
    const { searchIngredients } = meta();
    expect(searchIngredients('zzzzz')).toEqual([]);
  });
});

describe('shelf life table integrity', () => {
  it('gives every ingredient all three location keys', () => {
    const { ingredientShelfLife } = meta();

    Object.entries(ingredientShelfLife).forEach(([name, entry]) => {
      expect(Object.keys(entry).sort()).toEqual(['freezer', 'fridge', 'pantry']);
      expect(name).toBe(name.toLowerCase().trim());
    });
  });

  it('uses positive day counts or null, never zero or negative', () => {
    const { ingredientShelfLife } = meta();

    const bad = Object.entries(ingredientShelfLife).flatMap(([name, entry]) =>
      Object.entries(entry)
        .filter(([, days]) => days !== null && !(typeof days === 'number' && days > 0))
        .map(([location, days]) => `${name}.${location}=${days}`)
    );

    expect(bad).toEqual([]);
  });

  it('never claims the fridge preserves food longer than the freezer', () => {
    const { ingredientShelfLife } = meta();

    const inverted = Object.entries(ingredientShelfLife)
      .filter(([, { fridge, freezer }]) => fridge !== null && freezer !== null && freezer < fridge)
      .map(([name, { fridge, freezer }]) => `${name}: fridge ${fridge} > freezer ${freezer}`);

    expect(inverted).toEqual([]);
  });
});

describe('useIngredientAutocomplete', () => {
  it('stays quiet until the term is at least two characters', () => {
    expect(renderHook(() => useIngredientAutocomplete('')).result.current).toEqual([]);
    expect(renderHook(() => useIngredientAutocomplete('c')).result.current).toEqual([]);
  });

  it('suggests matches once the term is long enough', () => {
    const { result } = renderHook(() => useIngredientAutocomplete('ch'));
    expect(result.current.length).toBeGreaterThan(0);
    result.current.forEach((s) => expect(s).toContain('ch'));
  });

  it('caps suggestions at ten so the dropdown stays usable', () => {
    const { result } = renderHook(() => useIngredientAutocomplete('e'));
    expect(result.current.length).toBeLessThanOrEqual(10);
  });
});
