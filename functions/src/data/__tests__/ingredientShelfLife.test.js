/**
 * Shelf life data drives every expiration date, every waste alert, and the
 * freezer suggestions in Phase 6. Bad data here is silent — an item gets a
 * plausible-looking but wrong expiry — so the table is validated structurally.
 */

const shelfLifeModule = require('../ingredientShelfLife');

const table = shelfLifeModule.ingredientShelfLife || shelfLifeModule;
const LOCATIONS = ['fridge', 'freezer', 'pantry'];

describe('ingredient shelf life table', () => {
  it('contains a useful number of ingredients', () => {
    expect(Object.keys(table).length).toBeGreaterThan(30);
  });

  it('keys every ingredient in normalized lower-case form', () => {
    // Lookups normalize the search term, so a capitalised key is unreachable.
    const unreachable = Object.keys(table).filter((k) => k !== k.toLowerCase().trim());
    expect(unreachable).toEqual([]);
  });

  it('gives every ingredient all three location keys', () => {
    const incomplete = Object.entries(table)
      .filter(([, entry]) => LOCATIONS.some((loc) => !(loc in entry)))
      .map(([name]) => name);

    expect(incomplete).toEqual([]);
  });

  it('uses a positive number of days, or null for "does not belong here"', () => {
    const invalid = Object.entries(table).flatMap(([name, entry]) =>
      LOCATIONS.filter((loc) => {
        const days = entry[loc];
        return days !== null && !(typeof days === 'number' && Number.isFinite(days) && days > 0);
      }).map((loc) => `${name}.${loc}=${entry[loc]}`)
    );

    expect(invalid).toEqual([]);
  });

  it('never stores an ingredient nowhere at all', () => {
    const homeless = Object.entries(table)
      .filter(([, entry]) => LOCATIONS.every((loc) => entry[loc] === null))
      .map(([name]) => name);

    expect(homeless).toEqual([]);
  });

  it('never claims the fridge keeps food longer than the freezer', () => {
    const inverted = Object.entries(table)
      .filter(([, { fridge, freezer }]) => fridge !== null && freezer !== null && freezer < fridge)
      .map(([name, { fridge, freezer }]) => `${name}: fridge ${fridge} > freezer ${freezer}`);

    expect(inverted).toEqual([]);
  });

  it('keeps every shelf life inside a plausible range (under 5 years)', () => {
    const implausible = Object.entries(table).flatMap(([name, entry]) =>
      LOCATIONS.filter((loc) => entry[loc] !== null && entry[loc] > 1825).map(
        (loc) => `${name}.${loc}=${entry[loc]}`
      )
    );

    expect(implausible).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// Parity with the frontend copy
//
// src/hooks/useIngredientMetadata.js keeps its own copy of this table so the
// UI can calculate expiry offline. Two copies of the same data only stay
// honest if something checks them, and this is that something.
//
// The check used to look for `'name':` in the frontend source. The frontend
// file quotes only the keys that need it, so `milk:` never matched and 30 of
// the 38 shared ingredients — every single-word one — went uncompared. It also
// only looked at ingredients the backend had, so the frontend silently held a
// third of the table and the app fell back to a blanket per-location default
// for everything missing.
// ---------------------------------------------------------------------------

/** The frontend's table, parsed out of its source (the file is ESM). */
const readFrontendTable = () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../../../../src/hooks/useIngredientMetadata.js'),
    'utf8'
  );

  const start = source.indexOf('const ingredientShelfLife = {');
  const end = source.indexOf('\n};', start);
  if (start === -1 || end === -1) {
    throw new Error('Could not find the ingredientShelfLife literal in the frontend hook');
  }

  const parsed = {};
  for (const line of source.slice(start, end).split('\n')) {
    const entry = line.match(/^\s*'?([a-z][a-z ]*)'?:\s*\{(.+)\},?\s*$/);
    if (!entry) continue;

    const values = {};
    for (const pair of entry[2].split(',')) {
      const [key, raw] = pair.split(':').map((part) => part.trim());
      if (raw === undefined) continue;
      values[key] = raw === 'null' ? null : Number(raw);
    }
    parsed[entry[1]] = values;
  }
  return parsed;
};

describe('ingredient shelf life parity with the frontend', () => {
  const frontend = readFrontendTable();

  it('parses a table worth comparing', () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // turn every assertion below into a no-op, which is exactly how the
    // previous version of this check passed while comparing eight ingredients.
    expect(Object.keys(frontend).length).toBe(Object.keys(table).length);
    expect(frontend.milk).toEqual({ fridge: 7, freezer: 90, pantry: null });
  });

  it('knows exactly the same ingredients on both sides', () => {
    const backendOnly = Object.keys(table).filter((name) => !(name in frontend));
    const frontendOnly = Object.keys(frontend).filter((name) => !(name in table));

    // An ingredient the backend knows and the frontend does not is not
    // harmless: the app quietly falls back to the location default, so the
    // same jar of honey expires in 90 days in the browser and 730 on the
    // server.
    expect({ backendOnly, frontendOnly }).toEqual({ backendOnly: [], frontendOnly: [] });
  });

  it('agrees on every ingredient, in every location', () => {
    const disagreements = Object.entries(table).flatMap(([name, entry]) =>
      LOCATIONS.filter((loc) => frontend[name] && frontend[name][loc] !== entry[loc]).map(
        (loc) => `${name}.${loc}: backend ${entry[loc]}, frontend ${frontend[name][loc]}`
      )
    );

    expect(disagreements).toEqual([]);
  });
});
