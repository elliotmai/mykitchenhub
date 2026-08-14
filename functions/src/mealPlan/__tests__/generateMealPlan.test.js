/**
 * Meal plan generation — roadmap 7.2 / 7.3.
 *
 * The Anthropic client is always a fake: these tests must never cost money or
 * need the network. firebase-admin is mocked with a recording fake so the reads
 * can be driven per test without an emulator.
 */

jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }));

const {
  generatePlanForUser,
  NO_KEY_WARNING,
  FAILED_WARNING,
  MAX_DAYS,
} = require('../generateMealPlan');
const { buildPrompt, SYSTEM_PROMPT } = require('../buildPrompt');
const { collectPlanContext, toDayKey, startOfWeek, weekDayKeys } = require('../planContext');
const { parsePlan, extractJson, deriveShoppingList } = require('../parsePlan');
const { buildFallbackPlan, scoreRecipe, isExcluded } = require('../fallbackPlan');
const { PLAN_SCHEMA } = require('../planSchema');
const { textOf, resolveApiKey, createClient, requestPlan, MODEL } = require('../anthropicClient');

const UID = 'user-123';
const WEEK_START = '2026-08-10';
const DAYS = weekDayKeys(WEEK_START, 7);

// ---------------------------------------------------------------------------
// Firestore fake
// ---------------------------------------------------------------------------

const snapshot = (records) => ({
  docs: records.map(({ id, ...data }) => ({ id, data: () => data })),
  empty: records.length === 0,
  size: records.length,
});

/**
 * @param {object} data - { profile, inventory, recipes, entries }
 */
const makeDb = (data = {}) => {
  const collectionRef = (path) => ({
    __path: path,
    limit: () => collectionRef(path),
    get: jest.fn(async () => {
      if (path === 'recipes') return snapshot(data.recipes || []);
      if (path.endsWith('/inventory')) return snapshot(data.inventory || []);
      if (path.endsWith('/mealPlanEntries')) return snapshot(data.entries || []);
      return snapshot([]);
    }),
  });

  const docRef = (path) => ({
    __path: path,
    get: jest.fn(async () => ({
      exists: Boolean(data.profile),
      data: () => data.profile || {},
    })),
    collection: (name) => collectionRef(`${path}/${name}`),
  });

  return { collection: (name) => ({ ...collectionRef(name), doc: (id) => docRef(`${name}/${id}`) }) };
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

const item = (overrides = {}) => ({
  id: `item-${overrides.name || 'milk'}`,
  name: 'Spinach',
  normalized: 'spinach',
  quantity: 2,
  unit: 'bag',
  expiresAt: daysFromNow(2),
  ...overrides,
});

const recipe = (overrides = {}) => ({
  id: 'recipe-1',
  name: 'Spinach Frittata',
  servings: 2,
  difficulty: 'easy',
  tags: ['dinner'],
  prepTime: 10,
  cookTime: 15,
  ingredients: [{ name: 'Spinach', normalized: 'spinach', quantity: 1, unit: 'bag' }],
  ...overrides,
});

const profile = (overrides = {}) => ({
  email: 'cook@example.com',
  preferences: { dietary: { restrictions: ['vegetarian'], allergies: [] }, defaultServings: 2 },
  helloFresh: { enabled: false, deliveryDays: [] },
  ...overrides,
});

/** A model response shaped like the schema demands. */
const modelPlan = (overrides = {}) => ({
  entries: DAYS.map((date) => ({
    date,
    mealType: 'dinner',
    recipeId: 'recipe-1',
    recipeName: 'Spinach Frittata',
    servings: 2,
    usesIngredients: [{ name: 'Spinach', normalized: 'spinach', quantity: 1, unit: 'bag' }],
    batchGroup: '',
    notes: '',
  })),
  shoppingList: [],
  batchCooking: [],
  notes: '',
  ...overrides,
});

/** An Anthropic client fake. Never talks to the network. */
const fakeClient = (payload, options = {}) => ({
  messages: {
    create: jest.fn(async () => ({
      model: options.model || MODEL,
      stop_reason: options.stopReason || 'end_turn',
      content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
    })),
  },
});

const run = (dbData, client, options = {}) =>
  generatePlanForUser({
    uid: UID,
    weekStart: WEEK_START,
    db: makeDb(dbData),
    client,
    ...options,
  });

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

describe('collectPlanContext', () => {
  it('gathers the kitchen, the preferences and the recipe library', async () => {
    const context = await collectPlanContext(
      makeDb({
        profile: profile(),
        inventory: [item(), item({ id: 'item-rice', name: 'Rice', normalized: 'rice', expiresAt: daysFromNow(200) })],
        recipes: [recipe()],
      }),
      UID,
      WEEK_START
    );

    expect(context.dayKeys).toEqual(DAYS);
    expect(context.inventory).toHaveLength(2);
    expect(context.recipes[0].name).toBe('Spinach Frittata');
    expect(context.preferences.dietaryRestrictions).toEqual(['vegetarian']);
  });

  it('surfaces only what is close to expiring, soonest first', async () => {
    const context = await collectPlanContext(
      makeDb({
        inventory: [
          item({ id: 'a', name: 'Rice', normalized: 'rice', expiresAt: daysFromNow(200) }),
          item({ id: 'b', name: 'Fish', normalized: 'fish', expiresAt: daysFromNow(5) }),
          item({ id: 'c', name: 'Salad', normalized: 'salad', expiresAt: daysFromNow(1) }),
        ],
      }),
      UID,
      WEEK_START
    );

    expect(context.expiring.map((i) => i.name)).toEqual(['Salad', 'Fish']);
  });

  it('leaves days a HelloFresh meal already owns out of the open days', async () => {
    const context = await collectPlanContext(
      makeDb({
        entries: [
          {
            id: 'hf-1',
            date: DAYS[0],
            mealType: 'dinner',
            source: 'hellofresh',
            recipeName: 'Delivered Box',
          },
        ],
      }),
      UID,
      WEEK_START
    );

    expect(context.takenDays).toEqual([DAYS[0]]);
    expect(context.openDays).not.toContain(DAYS[0]);
    expect(context.openDays).toHaveLength(6);
  });

  it('reads preferences written under either shape', async () => {
    const context = await collectPlanContext(
      makeDb({
        profile: profile({
          preferences: {
            dietaryRestrictions: ['gluten-free'],
            dislikedIngredients: ['cilantro'],
            defaultServings: 4,
          },
        }),
      }),
      UID,
      WEEK_START
    );

    expect(context.preferences).toMatchObject({
      dietaryRestrictions: ['gluten-free'],
      dislikedIngredients: ['cilantro'],
      defaultServings: 4,
    });
  });

  it('maps HelloFresh delivery weekdays onto the week being planned', async () => {
    const context = await collectPlanContext(
      makeDb({ profile: profile({ helloFresh: { enabled: true, mealsPerWeek: 3, deliveryDays: [1, 3, 5] } }) }),
      UID,
      WEEK_START
    );

    expect(context.helloFresh.active).toBe(true);
    expect(context.helloFresh.deliveryDayKeys).toEqual([DAYS[0], DAYS[2], DAYS[4]]);
  });

  it('copes with a user who has no profile document yet', async () => {
    const context = await collectPlanContext(makeDb({}), UID, WEEK_START);

    expect(context.preferences.defaultServings).toBe(2);
    expect(context.openDays).toEqual(DAYS);
  });
});

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  const context = {
    weekStart: WEEK_START,
    dayKeys: DAYS,
    openDays: DAYS.slice(1),
    takenDays: [DAYS[0]],
    preferences: {
      dietaryRestrictions: ['vegetarian'],
      allergies: ['peanuts'],
      dislikedIngredients: ['cilantro'],
      defaultServings: 3,
    },
    helloFresh: { active: true, mealsPerWeek: 3, deliveryDayKeys: [DAYS[0]] },
    inventory: [{ name: 'Spinach', normalized: 'spinach', quantity: 2, unit: 'bag' }],
    expiring: [
      { name: 'Spinach', normalized: 'spinach', quantity: 2, unit: 'bag', daysUntilExpiry: 1 },
    ],
    recipes: [recipe()],
    existingEntries: [],
  };

  it('states the priority order in the system prompt', () => {
    expect(SYSTEM_PROMPT).toMatch(/expire soonest/);
    expect(SYSTEM_PROMPT).toMatch(/dietary restriction/i);
    expect(SYSTEM_PROMPT).toMatch(/batchGroup/);
  });

  it('names the days to fill and the days to leave alone', () => {
    const { user } = buildPrompt(context);

    expect(user).toContain(DAYS.slice(1).join(', '));
    expect(user).toMatch(new RegExp(`DAYS ALREADY TAKEN[^\\n]*${DAYS[0]}`));
  });

  it('leads with what is about to expire, and by when', () => {
    const { user } = buildPrompt(context);
    expect(user).toMatch(/Spinach \(2 bag, expires in 1 days\)/);
  });

  it('passes the dietary restrictions, allergies and dislikes through', () => {
    const { user } = buildPrompt(context);

    expect(user).toMatch(/Dietary restrictions: vegetarian/);
    expect(user).toMatch(/Allergies: peanuts/);
    expect(user).toMatch(/Dislikes: cilantro/);
    expect(user).toMatch(/Servings per meal: 3/);
  });

  it('describes the HelloFresh schedule', () => {
    const { user } = buildPrompt(context);
    expect(user).toMatch(/HelloFresh is active with 3 meals per week/);
  });

  it('lists the recipe library with ids the model can copy back', () => {
    const { user } = buildPrompt(context);
    expect(user).toMatch(/recipe-1 \| Spinach Frittata \| serves 2/);
  });

  it('says plainly when there is nothing expiring and no library', () => {
    const { user } = buildPrompt({ ...context, expiring: [], recipes: [], inventory: [] });

    expect(user).toMatch(/Nothing is close to expiring/);
    expect(user).toMatch(/no saved recipes/);
    expect(user).toMatch(/The kitchen is empty/);
  });

  it('says "none" rather than leaving a restriction line blank', () => {
    const { user } = buildPrompt({
      ...context,
      preferences: { ...context.preferences, dietaryRestrictions: [], allergies: [] },
    });

    expect(user).toMatch(/Dietary restrictions: none/);
    expect(user).toMatch(/Allergies: none/);
  });
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('extractJson', () => {
  it('passes an object straight through', () => {
    expect(extractJson({ entries: [] })).toEqual({ entries: [] });
  });

  it('parses plain JSON text', () => {
    expect(extractJson('{"entries":[]}')).toEqual({ entries: [] });
  });

  it('survives a code fence', () => {
    expect(extractJson('```json\n{"entries":[]}\n```')).toEqual({ entries: [] });
  });

  it('digs the object out of surrounding prose', () => {
    expect(extractJson('Here is your plan:\n{"entries":[]}\nEnjoy!')).toEqual({ entries: [] });
  });

  it('returns null for something unparseable', () => {
    expect(extractJson('sorry, no plan today')).toBeNull();
    expect(extractJson(null)).toBeNull();
  });
});

describe('parsePlan', () => {
  const context = {
    weekStart: WEEK_START,
    openDays: DAYS,
    preferences: { defaultServings: 2 },
    recipes: [recipe()],
    inventory: [{ name: 'Spinach', normalized: 'spinach', quantity: 9, unit: 'bag' }],
  };

  it('accepts a well-formed plan', () => {
    const plan = parsePlan(modelPlan(), context);

    expect(plan.entries).toHaveLength(7);
    expect(plan.entries[0]).toMatchObject({
      date: DAYS[0],
      mealType: 'dinner',
      recipeId: 'recipe-1',
      recipeName: 'Spinach Frittata',
      servings: 2,
      batchGroup: null,
    });
  });

  it('drops a meal planned outside the week', () => {
    const plan = parsePlan(
      modelPlan({
        entries: [
          { ...modelPlan().entries[0], date: '2026-12-25' },
          modelPlan().entries[1],
        ],
      }),
      context
    );

    expect(plan.entries.map((e) => e.date)).toEqual([DAYS[1]]);
  });

  it('drops a meal planned on a day HelloFresh already owns', () => {
    const plan = parsePlan(modelPlan(), { ...context, openDays: DAYS.slice(1) });

    expect(plan.entries.map((e) => e.date)).not.toContain(DAYS[0]);
    expect(plan.entries).toHaveLength(6);
  });

  it('drops a second dinner double-booked on the same day', () => {
    const [first] = modelPlan().entries;
    const plan = parsePlan(
      modelPlan({ entries: [first, { ...first, recipeName: 'Also Dinner' }] }),
      context
    );

    expect(plan.entries).toHaveLength(1);
  });

  it('drops a meal with no name rather than writing an unusable entry', () => {
    const plan = parsePlan(
      modelPlan({ entries: [{ ...modelPlan().entries[0], recipeName: '   ' }, modelPlan().entries[1]] }),
      context
    );

    expect(plan.entries).toHaveLength(1);
  });

  it('falls back to the household serving size when the model asks for none', () => {
    const plan = parsePlan(
      modelPlan({ entries: [{ ...modelPlan().entries[0], servings: 0 }] }),
      context
    );

    expect(plan.entries[0].servings).toBe(2);
  });

  it('never lets servings go below one, which the rules would reject', () => {
    const plan = parsePlan(
      modelPlan({ entries: [{ ...modelPlan().entries[0], servings: -4 }] }),
      context
    );

    expect(plan.entries[0].servings).toBe(1);
  });

  it('rejects a recipe id that is not in the library', () => {
    const plan = parsePlan(
      modelPlan({ entries: [{ ...modelPlan().entries[0], recipeId: 'made-up' }] }),
      context
    );

    expect(plan.entries[0].recipeId).toBeNull();
  });

  it('falls back to the library ingredients when the model omits them', () => {
    const plan = parsePlan(
      modelPlan({ entries: [{ ...modelPlan().entries[0], usesIngredients: [] }] }),
      context
    );

    expect(plan.entries[0].usesIngredients).toEqual(recipe().ingredients);
  });

  it('normalises the batch group into null when empty', () => {
    const plan = parsePlan(
      modelPlan({
        entries: [
          { ...modelPlan().entries[0], batchGroup: '  roast-veg ' },
          { ...modelPlan().entries[1], batchGroup: '' },
        ],
      }),
      context
    );

    expect(plan.entries[0].batchGroup).toBe('roast-veg');
    expect(plan.entries[1].batchGroup).toBeNull();
  });

  it('keeps only batch tips that span at least two planned days', () => {
    const plan = parsePlan(
      modelPlan({
        batchCooking: [
          { group: 'roast', title: 'Roast once', detail: 'One tray.', entryDates: [DAYS[0], DAYS[2]] },
          { group: 'lonely', title: 'Nope', detail: '', entryDates: [DAYS[0]] },
          { group: 'ghost', title: 'Nope', detail: '', entryDates: ['2026-12-25', '2026-12-26'] },
        ],
      }),
      context
    );

    expect(plan.batchCooking.map((t) => t.group)).toEqual(['roast']);
  });

  it('recomputes the shopping list rather than trusting the model’s arithmetic', () => {
    const plan = parsePlan(
      modelPlan({
        shoppingList: [
          { name: 'Caviar', normalized: 'caviar', quantity: 99, unit: 'tin', haveInInventory: false },
        ],
      }),
      context
    );

    expect(plan.shoppingList.map((i) => i.normalized)).toEqual(['spinach']);
    expect(plan.shoppingList[0].quantity).toBe(7);
  });

  it('returns null when nothing usable came back', () => {
    expect(parsePlan('not json at all', context)).toBeNull();
    expect(parsePlan({ entries: [] }, context)).toBeNull();
    expect(parsePlan({}, context)).toBeNull();
  });
});

describe('deriveShoppingList', () => {
  it('marks what the kitchen already covers', () => {
    const list = deriveShoppingList(
      [
        {
          usesIngredients: [{ name: 'Rice', normalized: 'rice', quantity: 1, unit: 'cup' }],
        },
      ],
      [{ normalized: 'rice', quantity: 5 }]
    );

    expect(list[0].haveInInventory).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fallback planner
// ---------------------------------------------------------------------------

describe('buildFallbackPlan', () => {
  const context = {
    weekStart: WEEK_START,
    openDays: DAYS.slice(0, 3),
    preferences: { defaultServings: 2, allergies: [], dislikedIngredients: [] },
    expiring: [
      { name: 'Spinach', normalized: 'spinach', quantity: 2, unit: 'bag', daysUntilExpiry: 1 },
    ],
    inventory: [{ name: 'Spinach', normalized: 'spinach', quantity: 2, unit: 'bag' }],
    recipes: [
      recipe(),
      recipe({ id: 'recipe-2', name: 'Plain Rice', ingredients: [{ name: 'Rice', normalized: 'rice', quantity: 1, unit: 'cup' }] }),
    ],
  };

  it('fills every open day', () => {
    const plan = buildFallbackPlan(context);
    expect(plan.entries.map((e) => e.date)).toEqual(DAYS.slice(0, 3));
  });

  it('leads with the recipe that uses what expires first', () => {
    const plan = buildFallbackPlan(context);
    expect(plan.entries[0].recipeName).toBe('Spinach Frittata');
  });

  it('never suggests a recipe containing an allergen', () => {
    const plan = buildFallbackPlan({
      ...context,
      preferences: { ...context.preferences, allergies: ['spinach'] },
    });

    expect(plan.entries.map((e) => e.recipeName)).not.toContain('Spinach Frittata');
  });

  it('still gives the cook something when there are no recipes at all', () => {
    const plan = buildFallbackPlan({ ...context, recipes: [] });

    expect(plan.entries[0].recipeName).toBe('Use up the Spinach');
    expect(plan.entries[0].recipeId).toBeNull();
  });

  it('suggests batching when two different meals share an ingredient', () => {
    const plan = buildFallbackPlan({
      ...context,
      recipes: [recipe(), recipe({ id: 'recipe-2', name: 'Spinach Soup' })],
    });

    expect(plan.batchCooking[0]).toMatchObject({ group: 'spinach' });
    expect(plan.batchCooking[0].entryDates.length).toBeGreaterThan(1);
  });

  it('does not suggest batching one recipe with itself when the library is thin', () => {
    // A single recipe fills all seven days. "Prep spinach once, it's used in
    // Spinach Frittata and Spinach Frittata" is noise, not advice.
    const plan = buildFallbackPlan({ ...context, recipes: [recipe()] });

    expect(plan.batchCooking).toEqual([]);
  });

  it('returns null when the week has no room', () => {
    expect(buildFallbackPlan({ ...context, openDays: [] })).toBeNull();
  });
});

describe('scoreRecipe', () => {
  it('scores an urgent ingredient above one that keeps', () => {
    const expiring = [{ normalized: 'spinach', daysUntilExpiry: 1 }];
    const urgent = scoreRecipe(recipe(), expiring, []);
    const idle = scoreRecipe(
      recipe({ ingredients: [{ name: 'Rice', normalized: 'rice', quantity: 1, unit: 'cup' }] }),
      expiring,
      []
    );

    expect(urgent).toBeGreaterThan(idle);
  });

  it('gives a little credit for something already in the kitchen', () => {
    expect(scoreRecipe(recipe(), [], [{ normalized: 'spinach' }])).toBeGreaterThan(
      scoreRecipe(recipe(), [], [])
    );
  });
});

describe('isExcluded', () => {
  it.each(['allergies', 'dislikedIngredients'])('excludes a recipe by %s', (field) => {
    expect(isExcluded(recipe(), { [field]: ['spinach'] })).toBe(true);
  });

  it('keeps a recipe when nothing is banned', () => {
    expect(isExcluded(recipe(), {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The function itself
// ---------------------------------------------------------------------------

describe('generatePlanForUser', () => {
  const stocked = {
    profile: profile(),
    inventory: [item()],
    recipes: [recipe()],
  };

  it('sends the kitchen’s context to the model and returns the parsed plan', async () => {
    const client = fakeClient(modelPlan());
    const result = await run(stocked, client);

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    const request = client.messages.create.mock.calls[0][0];
    expect(request.model).toBe('claude-opus-5');
    expect(request.output_config.format).toEqual({ type: 'json_schema', schema: PLAN_SCHEMA });
    expect(request.messages[0].content).toMatch(/Spinach/);

    expect(result.warning).toBeNull();
    expect(result.plan.degraded).toBe(false);
    expect(result.plan.model).toBe('claude-opus-5');
    expect(result.plan.entries).toHaveLength(7);
  });

  it('plans around the days HelloFresh already owns', async () => {
    const client = fakeClient(modelPlan());
    const result = await run(
      {
        ...stocked,
        entries: [{ id: 'hf', date: DAYS[0], mealType: 'dinner', source: 'hellofresh', recipeName: 'Box' }],
      },
      client
    );

    expect(result.plan.entries.map((e) => e.date)).not.toContain(DAYS[0]);
  });

  it.each([
    ['vegetarian', { dietary: { restrictions: ['vegetarian'], allergies: [] } }],
    ['gluten-free', { dietaryRestrictions: ['gluten-free'] }],
    ['nut allergy', { dietary: { restrictions: [], allergies: ['peanuts'] } }],
    ['dislikes', { dislikedIngredients: ['cilantro'] }],
  ])('puts %s into the prompt', async (label, preferences) => {
    const client = fakeClient(modelPlan());
    await run({ ...stocked, profile: profile({ preferences }) }, client);

    const prompt = client.messages.create.mock.calls[0][0].messages[0].content;
    const term = label === 'nut allergy' ? 'peanuts' : label === 'dislikes' ? 'cilantro' : label;
    expect(prompt).toContain(term);
  });

  it('falls back to a local plan when no API key is configured', async () => {
    const result = await run(stocked, null);

    expect(result.warning).toBe(NO_KEY_WARNING);
    expect(result.plan.degraded).toBe(true);
    expect(result.plan.model).toBeNull();
    expect(result.plan.entries.length).toBeGreaterThan(0);
  });

  it('falls back when the API call fails, without leaking the error to the caller', async () => {
    const client = {
      messages: { create: jest.fn(async () => { throw new Error('401 x-api-key sk-live-secret'); }) },
    };
    const result = await run(stocked, client);

    expect(result.warning).toBe(FAILED_WARNING);
    expect(result.plan.degraded).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/sk-live-secret/);
  });

  it('falls back when the model refuses', async () => {
    const client = fakeClient(modelPlan(), { stopReason: 'refusal' });
    const result = await run(stocked, client);

    expect(result.warning).toBe(FAILED_WARNING);
    expect(result.plan.degraded).toBe(true);
  });

  it('falls back when the response is not a usable plan', async () => {
    const result = await run(stocked, fakeClient('I could not think of anything.'));

    expect(result.warning).toBe(FAILED_WARNING);
    expect(result.plan.degraded).toBe(true);
  });

  it('says so when the week is already full rather than planning nothing', async () => {
    const result = await run(
      {
        ...stocked,
        entries: DAYS.map((date, i) => ({
          id: `hf-${i}`,
          date,
          mealType: 'dinner',
          source: 'hellofresh',
          recipeName: 'Box',
        })),
      },
      fakeClient(modelPlan())
    );

    expect(result.plan.entries).toEqual([]);
    expect(result.warning).toMatch(/already has a meal planned/);
  });

  it('defaults to the current week when none is given', async () => {
    const result = await generatePlanForUser({
      uid: UID,
      db: makeDb(stocked),
      client: null,
    });

    expect(result.plan.weekStart).toBe(toDayKey(startOfWeek()));
  });

  it('caps how far ahead one call will plan', async () => {
    const result = await generatePlanForUser({
      uid: UID,
      weekStart: WEEK_START,
      days: 400,
      db: makeDb(stocked),
      client: null,
    });

    expect(result.plan.entries.length).toBeLessThanOrEqual(MAX_DAYS);
  });

  it('refuses to plan without a user', async () => {
    await expect(generatePlanForUser({ db: makeDb(stocked), client: null })).rejects.toThrow(
      /user id is required/
    );
  });
});

// ---------------------------------------------------------------------------
// Client wiring
// ---------------------------------------------------------------------------

describe('anthropicClient', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it('reads the key from the environment', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(resolveApiKey()).toBe('sk-ant-test');
  });

  it('returns no client at all when the key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(createClient(null)).toBeNull();
  });

  it('builds a client when a key is supplied', () => {
    expect(createClient('sk-ant-test')).toBeTruthy();
  });

  it('joins the text blocks of a response', () => {
    expect(
      textOf({ content: [{ type: 'text', text: 'a' }, { type: 'thinking', thinking: '' }, { type: 'text', text: 'b' }] })
    ).toBe('ab');
  });

  it('turns a refusal into an error rather than an empty plan', async () => {
    const client = fakeClient(modelPlan(), { stopReason: 'refusal' });
    await expect(requestPlan(client, { system: 's', user: 'u' })).rejects.toThrow(/declined/);
  });
});

// ---------------------------------------------------------------------------
// Regressions — each of these failed before the fix it names.
// ---------------------------------------------------------------------------

const { readHelloFresh, toWeekday, fromDayKey } = require('../planContext');
const { deriveBatchCooking } = require('../fallbackPlan');
const { REQUEST_TIMEOUT_MS, MAX_RETRIES } = require('../anthropicClient');

/** A kitchen with something in it and something to cook. */
const stockedKitchen = {
  profile: profile(),
  inventory: [item()],
  recipes: [recipe()],
};

describe('a response the model could not finish', () => {
  it('is refused rather than written as if it were a whole week', async () => {
    const client = fakeClient(modelPlan(), { stopReason: 'max_tokens' });

    await expect(
      requestPlan(client, { system: 'plan a week', user: 'the kitchen' })
    ).rejects.toThrow(/ran out of room/);
  });

  it('degrades the whole call to the local planner', async () => {
    const result = await run(stockedKitchen, fakeClient(modelPlan(), { stopReason: 'max_tokens' }));

    expect(result.warning).toBe(FAILED_WARNING);
    expect(result.plan.degraded).toBe(true);
    expect(result.plan.entries.length).toBeGreaterThan(0);
  });
});

describe('the API call is bounded by the function’s own deadline', () => {
  it('gives up well inside the 120s the callable runs with', () => {
    // Left at the SDK default (10 minutes, two retries) a slow call outlives
    // the function and the cook gets an error instead of the fallback plan.
    expect(REQUEST_TIMEOUT_MS * (MAX_RETRIES + 1)).toBeLessThan(120000);
  });

  it('hands those bounds to the client it builds', () => {
    const client = createClient('sk-test-not-a-real-key');

    // The SDK keeps them on the instance; assert on whichever it exposes.
    const timeout = client.timeout ?? client._options?.timeout;
    const retries = client.maxRetries ?? client._options?.maxRetries;
    expect(timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(retries).toBe(MAX_RETRIES);
  });
});

describe('a shopping list that counts units', () => {
  const entryUsing = (ingredients) => ({ usesIngredients: ingredients });

  it('does not add cups of flour to grams of flour', () => {
    const list = deriveShoppingList([
      entryUsing([{ name: 'Flour', normalized: 'flour', quantity: 2, unit: 'cup' }]),
      entryUsing([{ name: 'Flour', normalized: 'flour', quantity: 200, unit: 'g' }]),
    ]);

    expect(list).toHaveLength(2);
    expect(list.map((i) => `${i.quantity} ${i.unit}`)).toEqual(['2 cup', '200 g']);
  });

  it('does not let a bag in the pantry cover a recipe measured in grams', () => {
    const list = deriveShoppingList(
      [entryUsing([{ name: 'Flour', normalized: 'flour', quantity: 200, unit: 'g' }])],
      [{ name: 'Flour', normalized: 'flour', quantity: 1, unit: 'bag' }]
    );

    expect(list[0].haveInInventory).toBe(false);
    expect(list[0].onHand).toBe(0);
  });

  it('still totals the same ingredient in the same unit', () => {
    const list = deriveShoppingList([
      entryUsing([{ name: 'Flour', normalized: 'flour', quantity: 2, unit: 'cup' }]),
      entryUsing([{ name: 'Flour', normalized: 'flour', quantity: 1, unit: 'cup' }]),
    ]);

    expect(list).toEqual([
      expect.objectContaining({ normalized: 'flour', quantity: 3, unit: 'cup' }),
    ]);
  });

  it('reports how much of a partly-stocked ingredient is on hand', () => {
    const list = deriveShoppingList(
      [entryUsing([{ name: 'Rice', normalized: 'rice', quantity: 5, unit: 'cup' }])],
      [{ name: 'Rice', normalized: 'rice', quantity: 2, unit: 'cup' }]
    );

    expect(list[0]).toMatchObject({ onHand: 2, haveInInventory: false });
  });
});

describe('a library recipe with no ingredients listed', () => {
  it('yields an empty array, not the undefined Firestore rejects', () => {
    const context = {
      openDays: DAYS,
      recipes: [{ id: 'recipe-bare', name: 'Toast' }],
      inventory: [],
      preferences: { defaultServings: 2 },
    };

    const parsed = parsePlan(
      {
        entries: [
          {
            date: DAYS[0],
            mealType: 'dinner',
            recipeId: 'recipe-bare',
            recipeName: 'Toast',
            servings: 2,
            usesIngredients: [],
            batchGroup: '',
            notes: '',
          },
        ],
      },
      context
    );

    expect(parsed.entries[0].usesIngredients).toEqual([]);
  });
});

describe('HelloFresh delivery days as the schema documents them', () => {
  const weekKeys = weekDayKeys(WEEK_START, 7); // 2026-08-10 is a Monday

  it('reads the documented singular `deliveryDay` name', () => {
    const hf = readHelloFresh({ helloFresh: { enabled: true, deliveryDay: 'monday' } }, weekKeys);

    expect(hf.deliveryDayKeys).toEqual([WEEK_START]);
  });

  it('still reads a numeric `deliveryDays` list', () => {
    const hf = readHelloFresh({ helloFresh: { enabled: true, deliveryDays: [1, 4] } }, weekKeys);

    expect(hf.deliveryDayKeys).toEqual([weekKeys[0], weekKeys[3]]);
  });

  it('lands Sunday on Sunday under either numbering', () => {
    expect(toWeekday(7)).toBe(0);
    expect(toWeekday(0)).toBe(0);
    expect(readHelloFresh({ helloFresh: { deliveryDays: [7] } }, weekKeys).deliveryDayKeys).toEqual([
      weekKeys[6],
    ]);
  });

  it('drops a delivery day it cannot make sense of instead of guessing Monday', () => {
    expect(toWeekday('someday')).toBeNull();
    expect(toWeekday(99)).toBeNull();
    expect(
      readHelloFresh({ helloFresh: { deliveryDays: ['someday'] } }, weekKeys).deliveryDayKeys
    ).toEqual([]);
  });

  it('matches on the weekday a key falls on, not its position in the list', () => {
    // A week that starts on a Wednesday: "friday" must still be the Friday.
    const midWeek = weekDayKeys('2026-08-12', 7);
    const hf = readHelloFresh({ helloFresh: { deliveryDay: 'friday' } }, midWeek);

    expect(hf.deliveryDayKeys).toHaveLength(1);
    expect(fromDayKey(hf.deliveryDayKeys[0]).getDay()).toBe(5);
  });
});

describe('days that already have a dinner', () => {
  const dinnerOn = (date, overrides = {}) => ({
    id: `entry-${date}-${overrides.source || 'manual'}`,
    date,
    mealType: 'dinner',
    status: 'planned',
    source: 'manual',
    recipeName: 'Something',
    planId: null,
    ...overrides,
  });

  const openDaysFor = async (entries) =>
    (await collectPlanContext(makeDb({ entries }), UID, WEEK_START)).openDays;

  it('are off limits when the cook scheduled the meal by hand', async () => {
    expect(await openDaysFor([dinnerOn(DAYS[0])])).not.toContain(DAYS[0]);
  });

  it('are off limits when waste prevention put a meal there', async () => {
    const days = await openDaysFor([dinnerOn(DAYS[1], { source: 'waste-prevention' })]);
    expect(days).not.toContain(DAYS[1]);
  });

  it('are off limits when a previous AI meal has already been cooked', async () => {
    const days = await openDaysFor([
      dinnerOn(DAYS[2], { source: 'ai', planId: WEEK_START, status: 'cooked' }),
    ]);
    expect(days).not.toContain(DAYS[2]);
  });

  it('open back up for this week’s own uncooked AI meals, so regenerating works', async () => {
    const days = await openDaysFor(
      DAYS.map((date) => dinnerOn(date, { source: 'ai', planId: WEEK_START }))
    );
    expect(days).toEqual(DAYS);
  });

  it('open back up when the meal there was skipped', async () => {
    const days = await openDaysFor([dinnerOn(DAYS[3], { status: 'skipped' })]);
    expect(days).toContain(DAYS[3]);
  });

  it('stay open when the only meal there is lunch', async () => {
    const days = await openDaysFor([dinnerOn(DAYS[4], { mealType: 'lunch' })]);
    expect(days).toContain(DAYS[4]);
  });

  it('stop the planner double-booking a hand-scheduled dinner', async () => {
    const result = await run(
      { ...stockedKitchen, entries: [dinnerOn(DAYS[0])] },
      fakeClient(modelPlan())
    );

    expect(result.plan.entries.map((e) => e.date)).not.toContain(DAYS[0]);
  });
});

describe('batch tips from the local planner', () => {
  it('do not suggest cooking one meal together with itself', () => {
    const repeated = [
      { date: DAYS[0], recipeName: 'Curry', usesIngredients: [{ normalized: 'onion', name: 'Onion' }] },
      { date: DAYS[1], recipeName: 'Curry', usesIngredients: [{ normalized: 'onion', name: 'Onion' }] },
    ];

    expect(deriveBatchCooking(repeated)).toEqual([]);
  });

  it('still suggest it for two different meals', () => {
    const different = [
      { date: DAYS[0], recipeName: 'Curry', usesIngredients: [{ normalized: 'onion', name: 'Onion' }] },
      { date: DAYS[1], recipeName: 'Soup', usesIngredients: [{ normalized: 'onion', name: 'Onion' }] },
    ];

    expect(deriveBatchCooking(different)).toHaveLength(1);
  });
});
