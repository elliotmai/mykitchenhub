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

  it('suggests batching when the same ingredient spans two days', () => {
    const plan = buildFallbackPlan({ ...context, recipes: [recipe()] });

    expect(plan.batchCooking[0]).toMatchObject({ group: 'spinach' });
    expect(plan.batchCooking[0].entryDates.length).toBeGreaterThan(1);
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
