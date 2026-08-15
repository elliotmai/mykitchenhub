/**
 * The legacy sync, end to end, against fakes.
 *
 * This is the suite that has to be trusted, because the real thing costs money
 * and runs against a database we are not allowed to touch. Nothing here reaches
 * the network: both Firestores, Spoonacular and Claude are recording fakes, so
 * the tests assert *what* was written, *what* was spent, and *when* the sync
 * refuses to spend any more.
 */

jest.mock('firebase-functions', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const https = { onCall: jest.fn((handler) => handler), HttpsError };
  return {
    https,
    runWith: jest.fn(() => ({ https })),
    config: jest.fn(() => ({})),
  };
});

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  firestore: jest.fn(),
}));

const {
  runLegacySync,
  clampLimit,
  emptyState,
  adminUids,
  STATUS,
  SYNC_DOC_ID,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} = require('../syncLegacyRecipes');

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A legacy document as the Admin SDK would hand it over. */
const legacyDoc = (id, data) => ({
  id,
  ref: { path: `users/legacy-user/recipes/${id}` },
  data: () => data,
});

/**
 * Legacy Firestore fake. Records the query chain so tests can assert on
 * ordering and the resume cursor.
 */
const makeLegacyDb = (docs = [], { total = docs.length } = {}) => {
  const calls = { orderBy: [], limit: [], startAfter: [], doc: [] };

  const query = {
    orderBy: jest.fn((field) => {
      calls.orderBy.push(field);
      return query;
    }),
    limit: jest.fn((n) => {
      calls.limit.push(n);
      return query;
    }),
    startAfter: jest.fn((ref) => {
      calls.startAfter.push(ref);
      return query;
    }),
    get: jest.fn(async () => ({ docs, size: docs.length, empty: docs.length === 0 })),
    count: jest.fn(() => ({ get: async () => ({ data: () => ({ count: total }) }) })),
  };

  return {
    __calls: calls,
    collectionGroup: jest.fn(() => query),
    doc: jest.fn((path) => {
      calls.doc.push(path);
      return { path };
    }),
  };
};

/**
 * MyKitchenHub Firestore fake. `existingLegacyIds` drives the duplicate check;
 * everything written lands in `writes` keyed by collection.
 */
const makeDb = ({ metadata = null, existingLegacyIds = [] } = {}) => {
  const writes = [];
  const commits = [];

  const metaRef = { __path: `syncMetadata/${SYNC_DOC_ID}`, get: jest.fn(async () => ({
    exists: metadata !== null,
    data: () => metadata,
  })) };

  const recipesCollection = {
    doc: jest.fn(() => ({ __path: 'recipes/generated' })),
    where: jest.fn((field, op, value) => ({
      limit: () => ({
        get: async () => ({ empty: !(field === 'legacyId' && existingLegacyIds.includes(value)) }),
      }),
    })),
  };

  return {
    __writes: writes,
    __commits: commits,
    collection: jest.fn((name) => {
      if (name === 'syncMetadata') return { doc: () => metaRef };
      if (name === 'recipes') return recipesCollection;
      throw new Error(`unexpected collection: ${name}`);
    }),
    batch: jest.fn(() => ({
      set: jest.fn((ref, data) => writes.push({ path: ref.__path, data })),
      commit: jest.fn(async () => commits.push(true)),
    })),
  };
};

const recipeWrites = (db) => db.__writes.filter((w) => w.path === 'recipes/generated');
const metadataWrite = (db) => db.__writes.find((w) => w.path === `syncMetadata/${SYNC_DOC_ID}`);

const spoonHit = (overrides = {}) => ({
  findInstructions: jest.fn(async () => ({
    matched: true,
    cost: 0.005,
    instructions: ['Roast at 200C for 20 minutes.'],
    sourceId: 'spoonacular-99',
    imageUrl: 'https://img.test/99.jpg',
    servings: 3,
    cookTime: 20,
    ...overrides,
  })),
});

const spoonMiss = () => ({
  findInstructions: jest.fn(async () => ({ matched: false, cost: 0.005, reason: 'no-match' })),
});

const claudeHit = () => ({
  generateInstructions: jest.fn(async () => ({
    generated: true,
    cost: 0.013,
    instructions: ['Cook everything together.'],
  })),
});

const claudeMiss = () => ({
  generateInstructions: jest.fn(async () => ({ generated: false, cost: 0.004, reason: 'empty' })),
});

const ENV = { SPOONACULAR_API_KEY: 'spoon-key', ANTHROPIC_API_KEY: 'claude-key' };
const now = () => new Date('2026-08-14T12:00:00.000Z');

/** Two legacy recipes: one that already has instructions, one that does not. */
const WITH_INSTRUCTIONS = legacyDoc('legacy-1', {
  name: 'Grandma Chili',
  ingredients: ['2 lbs ground beef'],
  instructions: ['Brown the beef.', 'Simmer for an hour.'],
  tags: ['dinner'],
});

const WITHOUT_INSTRUCTIONS = legacyDoc('legacy-2', {
  name: 'Sheet Pan Salmon',
  ingredients: ['2 salmon fillets'],
  tags: ['dinner'],
});

// ---------------------------------------------------------------------------

describe('clampLimit', () => {
  it('defaults a missing or nonsense limit', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(clampLimit('lots')).toBe(DEFAULT_LIMIT);
    expect(clampLimit(0)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(-5)).toBe(DEFAULT_LIMIT);
  });

  it('caps a batch so one call can never run the whole library', () => {
    expect(clampLimit(10_000)).toBe(MAX_LIMIT);
  });

  it('honours a sensible request', () => {
    expect(clampLimit(25)).toBe(25);
  });
});

describe('emptyState', () => {
  it('starts idle, at zero, with nothing spent', () => {
    expect(emptyState()).toMatchObject({
      currentStatus: 'idle',
      recipesProcessed: 0,
      costAccumulated: 0,
      cursor: null,
    });
  });
});

describe('adminUids', () => {
  it('is empty when unset, which means any signed-in user may run it', () => {
    expect(adminUids({})).toEqual([]);
  });

  it('splits and trims a configured list', () => {
    expect(adminUids({ SYNC_ADMIN_UIDS: 'uid-a, uid-b ' })).toEqual(['uid-a', 'uid-b']);
  });
});

describe('runLegacySync — importing', () => {
  it('imports a recipe that already had instructions, for free', async () => {
    const db = makeDb();
    const spoon = spoonHit();
    const ai = claudeHit();

    const result = await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoon, claude: ai, env: ENV, now }
    );

    expect(result.imported).toBe(1);
    expect(result.cost).toBe(0);
    expect(spoon.findInstructions).not.toHaveBeenCalled();
    expect(ai.generateInstructions).not.toHaveBeenCalled();
  });

  it('writes a document the security rules will accept', async () => {
    const db = makeDb();

    await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    const [written] = recipeWrites(db);
    expect(written.data).toMatchObject({
      name: 'Grandma Chili',
      source: 'legacy',
      legacyId: 'legacy-1',
      timesCooked: 0,
      difficulty: 'medium',
    });
    expect(written.data.servings).toBeGreaterThan(0);
    expect(Array.isArray(written.data.ingredients)).toBe(true);
    expect(Array.isArray(written.data.instructions)).toBe(true);
    expect(written.data.tags).toEqual(expect.arrayContaining(['legacy']));
  });

  it('commits everything in one batch', async () => {
    const db = makeDb();

    await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(db.__commits).toHaveLength(1);
  });

  it('skips a recipe that was imported by an earlier run', async () => {
    const db = makeDb({ existingLegacyIds: ['legacy-1'] });

    const result = await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(recipeWrites(db)).toHaveLength(0);
  });
});

describe('runLegacySync — filling in instructions', () => {
  it('matches a missing recipe against Spoonacular first', async () => {
    const db = makeDb();
    const spoon = spoonHit();
    const ai = claudeHit();

    const result = await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]), spoonacular: spoon, claude: ai, env: ENV, now }
    );

    expect(spoon.findInstructions).toHaveBeenCalledWith('Sheet Pan Salmon', {
      apiKey: 'spoon-key',
    });
    expect(ai.generateInstructions).not.toHaveBeenCalled();
    expect(result.instructionSources.spoonacular).toBe(1);

    const [written] = recipeWrites(db);
    expect(written.data.instructions).toEqual(['Roast at 200C for 20 minutes.']);
    expect(written.data.sourceId).toBe('spoonacular-99');
    expect(written.data.tags).toContain('spoonacular-instructions');
  });

  it('falls back to Claude when Spoonacular has no match', async () => {
    const db = makeDb();
    const ai = claudeHit();

    const result = await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]), spoonacular: spoonMiss(), claude: ai, env: ENV, now }
    );

    expect(ai.generateInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Sheet Pan Salmon' }),
      { apiKey: 'claude-key' }
    );
    expect(result.instructionSources.ai_generated).toBe(1);

    const [written] = recipeWrites(db);
    expect(written.data.instructions).toEqual(['Cook everything together.']);
    expect(written.data.tags).toContain('ai-instructions');
  });

  it('still imports a recipe neither source could write, flagged for attention', async () => {
    const db = makeDb();

    const result = await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]), spoonacular: spoonMiss(), claude: claudeMiss(), env: ENV, now }
    );

    expect(result.imported).toBe(1);

    const [written] = recipeWrites(db);
    expect(written.data.tags).toContain('needs-instructions');
    // The rules require a non-empty document; a placeholder keeps it valid.
    expect(written.data.instructions.length).toBeGreaterThan(0);
  });

  it('adds up what every source spent', async () => {
    const result = await runLegacySync(
      { limit: 5 },
      {
        db: makeDb(),
        legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]),
        spoonacular: spoonMiss(),
        claude: claudeHit(),
        env: ENV,
        now,
      }
    );

    expect(result.cost).toBeCloseTo(0.005 + 0.013, 6);
  });
});

describe('runLegacySync — the cost ceiling', () => {
  it('stops before making a call that would breach the ceiling', async () => {
    const db = makeDb({ metadata: { costAccumulated: 0.999 } });
    const spoon = spoonHit();

    const result = await runLegacySync(
      { limit: 5 },
      {
        db,
        legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]),
        spoonacular: spoon,
        claude: claudeHit(),
        env: { ...ENV, LEGACY_SYNC_MAX_COST_USD: '1' },
        now,
      }
    );

    expect(spoon.findInstructions).not.toHaveBeenCalled();
    expect(result.status).toBe(STATUS.COST_LIMIT);
    expect(recipeWrites(db)).toHaveLength(0);
  });

  it('keeps whatever it managed to import before the ceiling', async () => {
    const db = makeDb({ metadata: { costAccumulated: 0.98 } });

    const result = await runLegacySync(
      { limit: 5 },
      {
        db,
        // First recipe is free (it has instructions); the second would spend.
        legacyDb: makeLegacyDb([WITH_INSTRUCTIONS, WITHOUT_INSTRUCTIONS]),
        spoonacular: spoonMiss(),
        claude: claudeHit(),
        env: { ...ENV, LEGACY_SYNC_MAX_COST_USD: '1' },
        now,
      }
    );

    expect(result.imported).toBe(1);
    expect(result.status).toBe(STATUS.COST_LIMIT);
    expect(recipeWrites(db)).toHaveLength(1);
  });

  it('records the ceiling and an explanation for the dashboard', async () => {
    const db = makeDb({ metadata: { costAccumulated: 0.999 } });

    await runLegacySync(
      { limit: 5 },
      {
        db,
        legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]),
        spoonacular: spoonHit(),
        claude: claudeHit(),
        env: { ...ENV, LEGACY_SYNC_MAX_COST_USD: '1' },
        now,
      }
    );

    const meta = metadataWrite(db);
    expect(meta.data.costLimitUsd).toBe(1);
    expect(meta.data.lastError).toMatch(/ceiling/i);
  });

  it('leaves the cursor in place at the ceiling, so the next run resumes', async () => {
    const db = makeDb({ metadata: { costAccumulated: 0.999 } });

    const result = await runLegacySync(
      { limit: 5 },
      {
        db,
        legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]),
        spoonacular: spoonHit(),
        claude: claudeHit(),
        env: { ...ENV, LEGACY_SYNC_MAX_COST_USD: '1' },
        now,
      }
    );

    expect(result.cursor).toBe('users/legacy-user/recipes/legacy-2');
  });
});

describe('runLegacySync — dry run', () => {
  it('writes nothing at all', async () => {
    const db = makeDb();

    const result = await runLegacySync(
      { limit: 5, dryRun: true },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(result.dryRun).toBe(true);
    expect(db.batch).not.toHaveBeenCalled();
    expect(db.__writes).toHaveLength(0);
  });

  it('spends nothing — no lookup, no generation', async () => {
    const spoon = spoonHit();
    const ai = claudeHit();

    const result = await runLegacySync(
      { limit: 5, dryRun: true },
      { db: makeDb(), legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]), spoonacular: spoon, claude: ai, env: ENV, now }
    );

    expect(spoon.findInstructions).not.toHaveBeenCalled();
    expect(ai.generateInstructions).not.toHaveBeenCalled();
    expect(result.cost).toBe(0);
  });

  it('reports what it would have imported', async () => {
    const result = await runLegacySync(
      { limit: 5, dryRun: true },
      { db: makeDb(), legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(result.imported).toBe(1);
    expect(result.results[0]).toMatchObject({ action: 'would-import', name: 'Grandma Chili' });
  });
});

describe('runLegacySync — resuming', () => {
  it('orders by document path so the cursor is stable', async () => {
    const legacyDb = makeLegacyDb([WITH_INSTRUCTIONS]);

    await runLegacySync(
      { limit: 5 },
      { db: makeDb(), legacyDb, spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(legacyDb.__calls.orderBy).toContain('__name__');
    expect(legacyDb.__calls.limit).toContain(5);
  });

  it('starts after the saved cursor', async () => {
    const legacyDb = makeLegacyDb([WITHOUT_INSTRUCTIONS]);
    const db = makeDb({ metadata: { cursor: 'users/legacy-user/recipes/legacy-1' } });

    await runLegacySync(
      { limit: 5 },
      { db, legacyDb, spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(legacyDb.__calls.doc).toContain('users/legacy-user/recipes/legacy-1');
    expect(legacyDb.__calls.startAfter).toHaveLength(1);
  });

  it('ignores the cursor when asked to start over', async () => {
    const legacyDb = makeLegacyDb([WITH_INSTRUCTIONS]);
    const db = makeDb({ metadata: { cursor: 'users/legacy-user/recipes/legacy-1' } });

    await runLegacySync(
      { limit: 5, restart: true },
      { db, legacyDb, spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(legacyDb.__calls.startAfter).toHaveLength(0);
  });

  it('advances the cursor past a skipped recipe', async () => {
    const db = makeDb({ existingLegacyIds: ['legacy-1'] });

    const result = await runLegacySync(
      { limit: 1 },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS], { total: 50 }), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(result.cursor).toBe('users/legacy-user/recipes/legacy-1');
  });

  it('clears the cursor and reports completion once the library runs out', async () => {
    const db = makeDb();

    const result = await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(result.status).toBe(STATUS.COMPLETED);
    expect(result.cursor).toBeNull();
    expect(metadataWrite(db).data.cursor).toBeNull();
  });

  it('stays in progress while a full batch keeps coming back', async () => {
    const docs = [WITH_INSTRUCTIONS, WITHOUT_INSTRUCTIONS];

    const result = await runLegacySync(
      { limit: 2 },
      { db: makeDb(), legacyDb: makeLegacyDb(docs, { total: 500 }), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(result.status).toBe(STATUS.IN_PROGRESS);
    expect(result.cursor).toBe('users/legacy-user/recipes/legacy-2');
  });
});

describe('runLegacySync — progress reporting', () => {
  it('accumulates counters across runs rather than overwriting them', async () => {
    const db = makeDb({
      metadata: {
        recipesProcessed: 40,
        recipesImported: 35,
        recipesSkipped: 5,
        instructionSources: { spoonacular: 20, ai_generated: 10 },
        costAccumulated: 1.5,
      },
    });

    await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS], { total: 500 }), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    const meta = metadataWrite(db).data;
    expect(meta.recipesProcessed).toBe(41);
    expect(meta.recipesImported).toBe(36);
    expect(meta.recipesSkipped).toBe(5);
    expect(meta.instructionSources).toEqual({ spoonacular: 21, ai_generated: 10 });
    expect(meta.costAccumulated).toBeCloseTo(1.505, 4);
  });

  it('records the total the legacy database reports', async () => {
    const db = makeDb();

    await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS], { total: 512 }), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(metadataWrite(db).data.recipesToProcess).toBe(512);
  });

  it('stamps the run time', async () => {
    const db = makeDb();

    await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(metadataWrite(db).data.lastSyncTimestamp).toBe('2026-08-14T12:00:00.000Z');
  });
});

describe('runLegacySync — the off switch', () => {
  it('refuses to run when the sync is disabled', async () => {
    const db = makeDb({ metadata: { enabled: false } });
    const spoon = spoonHit();

    const result = await runLegacySync(
      { limit: 5 },
      { db, legacyDb: makeLegacyDb([WITHOUT_INSTRUCTIONS]), spoonacular: spoon, claude: claudeHit(), env: ENV, now }
    );

    expect(result.status).toBe(STATUS.DISABLED);
    expect(spoon.findInstructions).not.toHaveBeenCalled();
    expect(db.__writes).toHaveLength(0);
  });

  it('still allows a dry run while disabled, so the dashboard can preview', async () => {
    const db = makeDb({ metadata: { enabled: false } });

    const result = await runLegacySync(
      { limit: 5, dryRun: true },
      { db, legacyDb: makeLegacyDb([WITH_INSTRUCTIONS]), spoonacular: spoonHit(), claude: claudeHit(), env: ENV, now }
    );

    expect(result.status).not.toBe(STATUS.DISABLED);
    expect(result.imported).toBe(1);
  });
});
