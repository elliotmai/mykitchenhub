/**
 * Seeded recipes have to satisfy the same rules as recipes a person adds.
 *
 * They previously did not — they were written with `title` and
 * `source: 'seed'`, neither of which the `recipes` rules accept — so every
 * seeded database was one production-rules switch away from breaking. These
 * tests pin the shape.
 */

jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }));

const { getFirestore } = require('firebase-admin/firestore');
const { seedRecipes, clearRecipes } = require('../seedData');

const RECIPE_SOURCES = ['legacy', 'spoonacular', 'ai-generated', 'user-created', 'hellofresh'];
const REQUIRED_FIELDS = [
  'name',
  'ingredients',
  'instructions',
  'source',
  'createdAt',
  'tags',
  'servings',
  'difficulty',
  'timesCooked',
];

let batches;
let queries;

const makeDb = ({ recipeDocs = [] } = {}) => ({
  collection: jest.fn((name) => ({
    __path: name,
    doc: jest.fn(() => ({ __path: `${name}/auto` })),
    where: jest.fn((field, op, value) => {
      queries.push({ collection: name, field, op, value });
      return { get: jest.fn(async () => ({ docs: recipeDocs, size: recipeDocs.length, forEach: (cb) => recipeDocs.forEach(cb) })) };
    }),
  })),
  batch: jest.fn(() => {
    const b = { set: jest.fn(), delete: jest.fn(), commit: jest.fn(async () => undefined) };
    batches.push(b);
    return b;
  }),
});

beforeEach(() => {
  batches = [];
  queries = [];
  getFirestore.mockReturnValue(makeDb());
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const seededRecipes = () => batches.flatMap((b) => b.set.mock.calls.map(([, data]) => data));

describe('seedRecipes', () => {
  it('seeds a handful of recipes and reports the count', async () => {
    const count = await seedRecipes('user-123');

    expect(count).toBeGreaterThan(0);
    expect(seededRecipes()).toHaveLength(count);
    expect(batches[0].commit).toHaveBeenCalled();
  });

  it.each(REQUIRED_FIELDS)('gives every recipe the required field `%s`', async (field) => {
    await seedRecipes('user-123');

    seededRecipes().forEach((recipe) => expect(recipe).toHaveProperty(field));
  });

  it('keys recipes on `name`, never on `title`', async () => {
    await seedRecipes('user-123');

    seededRecipes().forEach((recipe) => {
      expect(typeof recipe.name).toBe('string');
      expect(recipe.name.length).toBeGreaterThan(0);
      expect(recipe).not.toHaveProperty('title');
    });
  });

  it('uses a source the rules recognise — `seed` is not one of them', async () => {
    await seedRecipes('user-123');

    seededRecipes().forEach((recipe) => expect(RECIPE_SOURCES).toContain(recipe.source));
  });

  it('uses a documented difficulty and a positive serving count', async () => {
    await seedRecipes('user-123');

    seededRecipes().forEach((recipe) => {
      expect(['easy', 'medium', 'hard']).toContain(recipe.difficulty);
      expect(recipe.servings).toBeGreaterThan(0);
    });
  });

  it('starts every seeded recipe at zero cooks', async () => {
    await seedRecipes('user-123');

    seededRecipes().forEach((recipe) => expect(recipe.timesCooked).toBe(0));
  });

  it('normalizes every ingredient so inventory matching works', async () => {
    await seedRecipes('user-123');

    seededRecipes().forEach((recipe) => {
      expect(recipe.ingredients.length).toBeGreaterThan(0);
      recipe.ingredients.forEach((ingredient) => {
        expect(ingredient.normalized).toBe(ingredient.name.trim().toLowerCase());
      });
    });
  });

  it('writes instructions as a list of steps', async () => {
    await seedRecipes('user-123');

    seededRecipes().forEach((recipe) => {
      expect(Array.isArray(recipe.instructions)).toBe(true);
      expect(recipe.instructions.length).toBeGreaterThan(0);
    });
  });

  it('records who seeded the recipe so it can be cleared again', async () => {
    await seedRecipes('user-123');

    seededRecipes().forEach((recipe) => expect(recipe.createdBy).toBe('user-123'));
  });
});

describe('clearRecipes', () => {
  it('finds recipes by the field seedRecipes actually writes', async () => {
    await clearRecipes('user-123');

    expect(queries).toContainEqual({
      collection: 'recipes',
      field: 'createdBy',
      op: '==',
      value: 'user-123',
    });
  });

  it('deletes what it finds and reports the count', async () => {
    const docs = [{ ref: { __path: 'recipes/a' } }, { ref: { __path: 'recipes/b' } }];
    getFirestore.mockReturnValue(makeDb({ recipeDocs: docs }));

    const count = await clearRecipes('user-123');

    expect(count).toBe(2);
    expect(batches[0].delete).toHaveBeenCalledTimes(2);
    expect(batches[0].commit).toHaveBeenCalled();
  });
});
