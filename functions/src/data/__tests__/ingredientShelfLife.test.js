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

  it('agrees with the frontend copy of the table for shared ingredients', () => {
    // src/hooks/useIngredientMetadata.js keeps its own copy so the UI can
    // calculate expiry offline. Where both know an ingredient, they must agree.
    const frontendSource = require('fs').readFileSync(
      require('path').join(__dirname, '../../../../src/hooks/useIngredientMetadata.js'),
      'utf8'
    );

    const disagreements = Object.entries(table)
      .filter(([name]) => frontendSource.includes(`'${name}':`))
      .flatMap(([name, entry]) => {
        const line = frontendSource
          .split('\n')
          .find((l) => l.trim().startsWith(`'${name}':`));
        if (!line) return [];

        return LOCATIONS.filter((loc) => {
          const match = line.match(new RegExp(`${loc}:\\s*(null|\\d+)`));
          if (!match) return false;
          const frontendValue = match[1] === 'null' ? null : Number(match[1]);
          return frontendValue !== entry[loc];
        }).map((loc) => `${name}.${loc}: backend ${entry[loc]}`);
      });

    expect(disagreements).toEqual([]);
  });
});
