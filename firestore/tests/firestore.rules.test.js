/**
 * Firestore security rules tests.
 *
 * These run against the Firestore emulator with the real firestore.rules file,
 * so they verify what the deployed database will actually enforce — including
 * the field-shape requirements that client code has to satisfy.
 *
 * Run with:  npm run test:rules   (starts the emulator via emulators:exec)
 *
 * NOTE: the rules are stricter than "test mode". Any client write that fails
 * here will fail in production once roadmap step 10.2 switches Firestore out
 * of test mode — that is exactly what these tests exist to catch early.
 */

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const OWNER = 'user-owner';
const INTRUDER = 'user-intruder';

let testEnv;

/** Firestore handle authenticated as `uid`. */
const as = (uid) => testEnv.authenticatedContext(uid).firestore();
/** Firestore handle for a signed-out visitor. */
const anon = () => testEnv.unauthenticatedContext().firestore();

// ---------------------------------------------------------------------------
// Valid document fixtures — these mirror what the app actually writes.
// If a fixture needs changing, the client that writes it needs changing too.
// ---------------------------------------------------------------------------

const validUser = (overrides = {}) => ({
  email: 'cook@example.com',
  createdAt: new Date().toISOString(),
  preferences: { smsAlerts: { enabled: false } },
  helloFresh: { linked: false },
  ...overrides,
});

const validLocation = (overrides = {}) => ({
  label: 'Main Fridge',
  type: 'fridge',
  icon: '🧊',
  color: '#3498db',
  order: 1,
  isDefault: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const validItem = (overrides = {}) => ({
  name: 'milk',
  normalized: 'milk',
  quantity: 1,
  unit: 'gal',
  locationId: 'loc-1',
  locationType: 'fridge',
  addedAt: new Date().toISOString(),
  source: 'manual',
  ...overrides,
});

const validImportRecord = (overrides = {}) => ({
  fileName: 'kitchen.csv',
  importedAt: new Date().toISOString(),
  itemsImported: 42,
  itemsSkipped: 3,
  status: 'completed',
  source: 'csv-import',
  errorCount: 3,
  errors: [{ row: 7, message: 'Missing quantity.' }],
  ...overrides,
});

const validDelivery = (overrides = {}) => ({
  deliveredAt: new Date().toISOString(),
  weekOf: '2026-08-10',
  recipeIds: ['recipe-1', 'recipe-2', 'recipe-3'],
  recipeNames: ['Sweet Chili Chicken', 'Sheet Pan Salmon', 'Veggie Tacos'],
  mealCount: 3,
  itemsAdded: 12,
  locationId: 'loc-fridge',
  status: 'received',
  source: 'hellofresh',
  notes: '',
  createdAt: new Date().toISOString(),
  ...overrides,
});

const validRecipe = (overrides = {}) => ({
  name: 'Sheet Pan Salmon',
  ingredients: [{ name: 'salmon', quantity: 2, unit: 'fillet' }],
  instructions: ['Roast at 400F for 15 minutes.'],
  source: 'user-created',
  createdAt: new Date().toISOString(),
  tags: ['dinner'],
  servings: 2,
  difficulty: 'easy',
  timesCooked: 0,
  ...overrides,
});

const validMealPlanEntry = (overrides = {}) => ({
  date: '2026-08-15',
  mealType: 'dinner',
  recipeId: 'recipe-1',
  recipeName: 'Sheet Pan Salmon',
  servings: 2,
  status: 'planned',
  source: 'manual',
  createdAt: new Date().toISOString(),
  cookedAt: null,
  usesIngredients: [{ name: 'salmon', normalized: 'salmon', quantity: 2, unit: 'fillet' }],
  batchGroup: null,
  notes: '',
  planId: null,
  ...overrides,
});

const validMealPlan = (overrides = {}) => ({
  weekStart: '2026-08-10',
  createdAt: new Date().toISOString(),
  source: 'ai',
  status: 'active',
  generatedAt: new Date().toISOString(),
  model: 'claude-opus-5',
  degraded: false,
  shoppingList: [
    { name: 'salmon', normalized: 'salmon', quantity: 2, unit: 'fillet', haveInInventory: false },
  ],
  batchCooking: [],
  notes: '',
  ...overrides,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || 'mykitchenhub-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Seed a document bypassing rules, for testing reads/updates/deletes. */
const seed = (fn) => testEnv.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

// ---------------------------------------------------------------------------
// users/{userId}
// ---------------------------------------------------------------------------

describe('users collection', () => {
  it('lets an owner create their own profile', async () => {
    await assertSucceeds(as(OWNER).doc(`users/${OWNER}`).set(validUser()));
  });

  it('rejects a profile missing required fields', async () => {
    await assertFails(as(OWNER).doc(`users/${OWNER}`).set({ email: 'cook@example.com' }));
  });

  it('stops a user creating a profile under someone else\'s id', async () => {
    await assertFails(as(INTRUDER).doc(`users/${OWNER}`).set(validUser()));
  });

  it('stops a signed-out visitor creating a profile', async () => {
    await assertFails(anon().doc(`users/${OWNER}`).set(validUser()));
  });

  it('lets an owner read their own profile', async () => {
    await seed((db) => db.doc(`users/${OWNER}`).set(validUser()));
    await assertSucceeds(as(OWNER).doc(`users/${OWNER}`).get());
  });

  it("stops one user reading another user's profile", async () => {
    await seed((db) => db.doc(`users/${OWNER}`).set(validUser()));
    await assertFails(as(INTRUDER).doc(`users/${OWNER}`).get());
  });

  it('lets an owner update mutable profile fields', async () => {
    const profile = validUser();
    await seed((db) => db.doc(`users/${OWNER}`).set(profile));

    await assertSucceeds(
      as(OWNER).doc(`users/${OWNER}`).update({
        createdAt: profile.createdAt,
        email: profile.email,
        displayName: 'Chef Eli',
      })
    );
  });

  it('refuses to let a user rewrite their signup date or email', async () => {
    const profile = validUser();
    await seed((db) => db.doc(`users/${OWNER}`).set(profile));

    await assertFails(
      as(OWNER).doc(`users/${OWNER}`).update({ createdAt: profile.createdAt, email: 'new@example.com' })
    );
    await assertFails(
      as(OWNER).doc(`users/${OWNER}`).update({ createdAt: '1999-01-01', email: profile.email })
    );
  });

  it('never allows profile deletion from the client', async () => {
    await seed((db) => db.doc(`users/${OWNER}`).set(validUser()));
    await assertFails(as(OWNER).doc(`users/${OWNER}`).delete());
  });
});

// ---------------------------------------------------------------------------
// users/{userId}/storageLocations/{locationId}
// ---------------------------------------------------------------------------

describe('storage locations', () => {
  const locPath = (uid, id = 'loc-1') => `users/${uid}/storageLocations/${id}`;

  it('accepts the document shape the app writes', async () => {
    await assertSucceeds(as(OWNER).doc(locPath(OWNER)).set(validLocation()));
  });

  it('requires a label — the field the UI renders', async () => {
    const { label, ...withoutLabel } = validLocation();
    await assertFails(as(OWNER).doc(locPath(OWNER)).set(withoutLabel));
  });

  it('rejects a location keyed on `name` instead of `label`', async () => {
    const { label, ...rest } = validLocation();
    await assertFails(as(OWNER).doc(locPath(OWNER)).set({ ...rest, name: 'Main Fridge' }));
  });

  it.each(['fridge', 'freezer', 'pantry'])('accepts the %s location type', async (type) => {
    await assertSucceeds(as(OWNER).doc(locPath(OWNER, `loc-${type}`)).set(validLocation({ type })));
  });

  it('rejects an unknown location type', async () => {
    await assertFails(as(OWNER).doc(locPath(OWNER)).set(validLocation({ type: 'garage' })));
  });

  it("stops one user writing into another user's locations", async () => {
    await assertFails(as(INTRUDER).doc(locPath(OWNER)).set(validLocation()));
  });

  it('lets an owner delete a non-default location', async () => {
    await seed((db) => db.doc(locPath(OWNER)).set(validLocation({ isDefault: false })));
    await assertSucceeds(as(OWNER).doc(locPath(OWNER)).delete());
  });

  it('protects default locations from deletion', async () => {
    await seed((db) => db.doc(locPath(OWNER)).set(validLocation({ isDefault: true })));
    await assertFails(as(OWNER).doc(locPath(OWNER)).delete());
  });
});

// ---------------------------------------------------------------------------
// users/{userId}/inventory/{itemId}
// ---------------------------------------------------------------------------

describe('inventory items', () => {
  const itemPath = (uid, id = 'item-1') => `users/${uid}/inventory/${id}`;

  it('accepts the document shape useInventory.addItem writes', async () => {
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER)).set(validItem()));
  });

  it('requires `source` — an item tagged only with `addedBy` is rejected', async () => {
    const { source, ...rest } = validItem();
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set({ ...rest, addedBy: 'manual' }));
  });

  it.each(['manual', 'hellofresh', 'csv-import', 'seed'])('accepts source "%s"', async (source) => {
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER, `item-${source}`)).set(validItem({ source })));
  });

  it('rejects an unrecognised source', async () => {
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set(validItem({ source: 'telepathy' })));
  });

  it('requires a positive quantity on create', async () => {
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set(validItem({ quantity: 0 })));
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set(validItem({ quantity: -3 })));
  });

  it('allows an update to zero quantity, for a used-up item', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    await assertSucceeds(as(OWNER).doc(itemPath(OWNER)).update({ addedAt: item.addedAt, quantity: 0 }));
  });

  it('rejects a negative quantity on update', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    await assertFails(as(OWNER).doc(itemPath(OWNER)).update({ addedAt: item.addedAt, quantity: -1 }));
  });

  it('refuses to let the added date be rewritten', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    await assertFails(as(OWNER).doc(itemPath(OWNER)).update({ addedAt: '1999-01-01', quantity: 2 }));
  });

  it('rejects an unknown location type', async () => {
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set(validItem({ locationType: 'garage' })));
  });

  it("keeps one user out of another user's inventory", async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validItem()));

    await assertFails(as(INTRUDER).doc(itemPath(OWNER)).get());
    await assertFails(as(INTRUDER).doc(itemPath(OWNER)).delete());
    await assertFails(as(INTRUDER).doc(itemPath(OWNER, 'new')).set(validItem()));
  });

  it('keeps a signed-out visitor out entirely', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validItem()));
    await assertFails(anon().doc(itemPath(OWNER)).get());
  });

  it('lets an owner delete their own item', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validItem()));
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER)).delete());
  });
});

// ---------------------------------------------------------------------------
// users/{userId}/importHistory/{importId}
// ---------------------------------------------------------------------------

describe('import history', () => {
  const importPath = (uid, id = 'import-1') => `users/${uid}/importHistory/${id}`;

  it('accepts the record the CSV importer writes', async () => {
    await assertSucceeds(as(OWNER).doc(importPath(OWNER)).set(validImportRecord()));
  });

  it('requires the documented fields', async () => {
    const { itemsImported, ...withoutCount } = validImportRecord();
    await assertFails(as(OWNER).doc(importPath(OWNER)).set(withoutCount));
    await assertFails(as(OWNER).doc(importPath(OWNER)).set({ fileName: 'kitchen.csv' }));
  });

  it.each(['completed', 'partial', 'failed'])('accepts status "%s"', async (status) => {
    await assertSucceeds(
      as(OWNER).doc(importPath(OWNER, `import-${status}`)).set(validImportRecord({ status }))
    );
  });

  it('rejects an unrecognised status or source', async () => {
    await assertFails(as(OWNER).doc(importPath(OWNER)).set(validImportRecord({ status: 'ok' })));
    await assertFails(as(OWNER).doc(importPath(OWNER)).set(validImportRecord({ source: 'manual' })));
  });

  it('rejects negative counts', async () => {
    await assertFails(
      as(OWNER).doc(importPath(OWNER)).set(validImportRecord({ itemsImported: -1 }))
    );
    await assertFails(
      as(OWNER).doc(importPath(OWNER)).set(validImportRecord({ itemsSkipped: -1 }))
    );
  });

  it('accepts a failed import that added nothing', async () => {
    await assertSucceeds(
      as(OWNER)
        .doc(importPath(OWNER))
        .set(validImportRecord({ status: 'failed', itemsImported: 0, itemsSkipped: 12 }))
    );
  });

  it('never lets a past import be rewritten', async () => {
    await seed((db) => db.doc(importPath(OWNER)).set(validImportRecord()));
    await assertFails(as(OWNER).doc(importPath(OWNER)).update({ itemsImported: 999 }));
  });

  it('lets an owner read and clear their own history', async () => {
    await seed((db) => db.doc(importPath(OWNER)).set(validImportRecord()));

    await assertSucceeds(as(OWNER).doc(importPath(OWNER)).get());
    await assertSucceeds(as(OWNER).doc(importPath(OWNER)).delete());
  });

  it("keeps one user out of another user's import history", async () => {
    await seed((db) => db.doc(importPath(OWNER)).set(validImportRecord()));

    await assertFails(as(INTRUDER).doc(importPath(OWNER)).get());
    await assertFails(as(INTRUDER).doc(importPath(OWNER, 'new')).set(validImportRecord()));
    await assertFails(anon().doc(importPath(OWNER)).get());
  });
});

// users/{userId}/deliveries/{deliveryId}
// ---------------------------------------------------------------------------

describe('hellofresh deliveries', () => {
  const path = (uid, id = 'delivery-1') => `users/${uid}/deliveries/${id}`;

  it('accepts the document shape the Add Delivery workflow writes', async () => {
    await assertSucceeds(as(OWNER).doc(path(OWNER)).set(validDelivery()));
  });

  it.each([
    'deliveredAt',
    'source',
    'status',
    'recipeIds',
    'mealCount',
    'itemsAdded',
    'createdAt',
  ])('requires %s', async (field) => {
    const doc = validDelivery();
    delete doc[field];
    await assertFails(as(OWNER).doc(path(OWNER)).set(doc));
  });

  it.each(['scheduled', 'received', 'cooked'])('accepts status "%s"', async (status) => {
    await assertSucceeds(as(OWNER).doc(path(OWNER, `d-${status}`)).set(validDelivery({ status })));
  });

  it('rejects an unrecognised status', async () => {
    await assertFails(as(OWNER).doc(path(OWNER)).set(validDelivery({ status: 'in-transit' })));
  });

  it('only accepts hellofresh as the source', async () => {
    await assertFails(as(OWNER).doc(path(OWNER)).set(validDelivery({ source: 'manual' })));
  });

  it('rejects negative counts', async () => {
    await assertFails(as(OWNER).doc(path(OWNER)).set(validDelivery({ mealCount: -1 })));
    await assertFails(as(OWNER).doc(path(OWNER, 'd2')).set(validDelivery({ itemsAdded: -1 })));
  });

  it('allows an empty box — a delivery logged before its recipes were imported', async () => {
    await assertSucceeds(
      as(OWNER).doc(path(OWNER)).set(validDelivery({ mealCount: 0, itemsAdded: 0, recipeIds: [] }))
    );
  });

  it('lets an owner mark a delivery cooked', async () => {
    const delivery = validDelivery();
    await seed((db) => db.doc(path(OWNER)).set(delivery));

    await assertSucceeds(
      as(OWNER).doc(path(OWNER)).update({ createdAt: delivery.createdAt, status: 'cooked' })
    );
  });

  it('refuses to let the logged date be rewritten', async () => {
    await seed((db) => db.doc(path(OWNER)).set(validDelivery()));

    await assertFails(
      as(OWNER).doc(path(OWNER)).update({ createdAt: '1999-01-01', status: 'cooked' })
    );
  });

  it("keeps one user out of another user's delivery history", async () => {
    await seed((db) => db.doc(path(OWNER)).set(validDelivery()));

    await assertFails(as(INTRUDER).doc(path(OWNER)).get());
    await assertFails(as(INTRUDER).doc(path(OWNER, 'new')).set(validDelivery()));
    await assertFails(as(INTRUDER).doc(path(OWNER)).delete());
  });

  it('keeps a signed-out visitor out entirely', async () => {
    await seed((db) => db.doc(path(OWNER)).set(validDelivery()));
    await assertFails(anon().doc(path(OWNER)).get());
  });

  it('lets an owner delete a delivery logged by mistake', async () => {
    await seed((db) => db.doc(path(OWNER)).set(validDelivery()));
    await assertSucceeds(as(OWNER).doc(path(OWNER)).delete());
  });
});

// ---------------------------------------------------------------------------
// users/{userId}/mealPlanEntries/{entryId}
//
// Phase 5 (HelloFresh) and Phase 6 (waste prevention) both write into this
// collection, so these cases are the shared contract, not just Phase 7's.
// ---------------------------------------------------------------------------

describe('meal plan entries', () => {
  const entryPath = (uid, id = 'entry-1') => `users/${uid}/mealPlanEntries/${id}`;

  it('accepts the document shape the meal plan writes', async () => {
    await assertSucceeds(as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry()));
  });

  it('requires the documented fields', async () => {
    await assertFails(as(OWNER).doc(entryPath(OWNER)).set({ recipeName: 'Toast' }));
  });

  it('requires `recipeName` — an entry carrying only a recipeId is rejected', async () => {
    const { recipeName, ...rest } = validMealPlanEntry();
    await assertFails(as(OWNER).doc(entryPath(OWNER)).set(rest));
  });

  it('insists `date` is a YYYY-MM-DD string, not a Timestamp', async () => {
    await assertFails(as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry({ date: new Date() })));
    await assertFails(
      as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry({ date: '15/08/2026' }))
    );
    await assertFails(
      as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry({ date: '2026-8-5' }))
    );
  });

  it.each(['breakfast', 'lunch', 'dinner', 'snack'])('accepts mealType "%s"', async (mealType) => {
    await assertSucceeds(
      as(OWNER).doc(entryPath(OWNER, `entry-${mealType}`)).set(validMealPlanEntry({ mealType }))
    );
  });

  it('rejects an unrecognised meal type', async () => {
    await assertFails(
      as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry({ mealType: 'brunch' }))
    );
  });

  it.each(['manual', 'ai', 'hellofresh', 'waste-prevention'])(
    'accepts source "%s" — every feature that schedules meals',
    async (source) => {
      await assertSucceeds(
        as(OWNER).doc(entryPath(OWNER, `entry-${source}`)).set(validMealPlanEntry({ source }))
      );
    }
  );

  it('rejects an unrecognised source', async () => {
    await assertFails(
      as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry({ source: 'guesswork' }))
    );
  });

  it.each(['planned', 'cooked', 'skipped'])('accepts status "%s"', async (status) => {
    await assertSucceeds(
      as(OWNER).doc(entryPath(OWNER, `entry-${status}`)).set(validMealPlanEntry({ status }))
    );
  });

  it('rejects an unrecognised status', async () => {
    await assertFails(
      as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry({ status: 'burnt' }))
    );
  });

  it('requires a positive serving count', async () => {
    await assertFails(as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry({ servings: 0 })));
    await assertFails(as(OWNER).doc(entryPath(OWNER)).set(validMealPlanEntry({ servings: -2 })));
  });

  it('allows rescheduling a meal onto another day', async () => {
    const entry = validMealPlanEntry();
    await seed((db) => db.doc(entryPath(OWNER)).set(entry));

    await assertSucceeds(
      as(OWNER).doc(entryPath(OWNER)).update({ createdAt: entry.createdAt, date: '2026-08-17' })
    );
  });

  it('allows marking a meal cooked', async () => {
    const entry = validMealPlanEntry();
    await seed((db) => db.doc(entryPath(OWNER)).set(entry));

    await assertSucceeds(
      as(OWNER).doc(entryPath(OWNER)).update({
        createdAt: entry.createdAt,
        status: 'cooked',
        cookedAt: new Date().toISOString(),
      })
    );
  });

  it('refuses to let the creation date be rewritten', async () => {
    await seed((db) => db.doc(entryPath(OWNER)).set(validMealPlanEntry()));

    await assertFails(
      as(OWNER).doc(entryPath(OWNER)).update({ createdAt: '1999-01-01', status: 'cooked' })
    );
  });

  it("keeps one user out of another user's meal plan", async () => {
    await seed((db) => db.doc(entryPath(OWNER)).set(validMealPlanEntry()));

    await assertFails(as(INTRUDER).doc(entryPath(OWNER)).get());
    await assertFails(as(INTRUDER).doc(entryPath(OWNER)).delete());
    await assertFails(as(INTRUDER).doc(entryPath(OWNER, 'new')).set(validMealPlanEntry()));
  });

  it('keeps a signed-out visitor out entirely', async () => {
    await seed((db) => db.doc(entryPath(OWNER)).set(validMealPlanEntry()));
    await assertFails(anon().doc(entryPath(OWNER)).get());
  });

  it('lets an owner remove a scheduled meal', async () => {
    await seed((db) => db.doc(entryPath(OWNER)).set(validMealPlanEntry()));
    await assertSucceeds(as(OWNER).doc(entryPath(OWNER)).delete());
  });
});

// ---------------------------------------------------------------------------
// users/{userId}/mealPlans/{weekId}
// ---------------------------------------------------------------------------

describe('meal plan weeks', () => {
  const planPath = (uid, id = '2026-08-10') => `users/${uid}/mealPlans/${id}`;

  it('accepts the document shape generateMealPlan produces', async () => {
    await assertSucceeds(as(OWNER).doc(planPath(OWNER)).set(validMealPlan()));
  });

  it('requires the documented fields', async () => {
    await assertFails(as(OWNER).doc(planPath(OWNER)).set({ weekStart: '2026-08-10' }));
  });

  it('insists `weekStart` is a YYYY-MM-DD string', async () => {
    await assertFails(as(OWNER).doc(planPath(OWNER)).set(validMealPlan({ weekStart: new Date() })));
    await assertFails(
      as(OWNER).doc(planPath(OWNER)).set(validMealPlan({ weekStart: 'week of Aug 10' }))
    );
  });

  it.each(['ai', 'manual'])('accepts source "%s"', async (source) => {
    await assertSucceeds(as(OWNER).doc(planPath(OWNER, `p-${source}`)).set(validMealPlan({ source })));
  });

  it('rejects an unrecognised plan source', async () => {
    await assertFails(as(OWNER).doc(planPath(OWNER)).set(validMealPlan({ source: 'hellofresh' })));
  });

  it.each(['draft', 'active', 'archived'])('accepts status "%s"', async (status) => {
    await assertSucceeds(as(OWNER).doc(planPath(OWNER, `p-${status}`)).set(validMealPlan({ status })));
  });

  it('allows regenerating a week in place', async () => {
    const plan = validMealPlan();
    await seed((db) => db.doc(planPath(OWNER)).set(plan));

    await assertSucceeds(
      as(OWNER).doc(planPath(OWNER)).update({
        createdAt: plan.createdAt,
        shoppingList: [],
        batchCooking: [],
        generatedAt: new Date().toISOString(),
      })
    );
  });

  it('refuses to let the creation date be rewritten', async () => {
    await seed((db) => db.doc(planPath(OWNER)).set(validMealPlan()));
    await assertFails(as(OWNER).doc(planPath(OWNER)).update({ createdAt: '1999-01-01' }));
  });

  it("keeps one user out of another user's plans", async () => {
    await seed((db) => db.doc(planPath(OWNER)).set(validMealPlan()));

    await assertFails(as(INTRUDER).doc(planPath(OWNER)).get());
    await assertFails(as(INTRUDER).doc(planPath(OWNER)).set(validMealPlan()));
  });
});

// ---------------------------------------------------------------------------
// recipes/{recipeId} — shared across users
// ---------------------------------------------------------------------------

describe('recipes', () => {
  it('lets any signed-in user read the shared recipe library', async () => {
    await seed((db) => db.doc('recipes/r1').set(validRecipe()));
    await assertSucceeds(as(INTRUDER).doc('recipes/r1').get());
  });

  it('hides recipes from signed-out visitors', async () => {
    await seed((db) => db.doc('recipes/r1').set(validRecipe()));
    await assertFails(anon().doc('recipes/r1').get());
  });

  it('accepts a well-formed recipe', async () => {
    await assertSucceeds(as(OWNER).doc('recipes/r1').set(validRecipe()));
  });

  it('requires the documented fields', async () => {
    await assertFails(as(OWNER).doc('recipes/r1').set({ name: 'Toast' }));
  });

  it.each(['legacy', 'spoonacular', 'ai-generated', 'user-created', 'hellofresh'])(
    'accepts source "%s"',
    async (source) => {
      await assertSucceeds(as(OWNER).doc(`recipes/r-${source}`).set(validRecipe({ source })));
    }
  );

  it('rejects an unrecognised recipe source', async () => {
    await assertFails(as(OWNER).doc('recipes/r1').set(validRecipe({ source: 'seed' })));
  });

  it.each(['easy', 'medium', 'hard'])('accepts difficulty "%s"', async (difficulty) => {
    await assertSucceeds(as(OWNER).doc(`recipes/r-${difficulty}`).set(validRecipe({ difficulty })));
  });

  it('rejects an unrecognised difficulty', async () => {
    await assertFails(as(OWNER).doc('recipes/r1').set(validRecipe({ difficulty: 'impossible' })));
  });

  it('requires a positive serving count and a non-negative cook count', async () => {
    await assertFails(as(OWNER).doc('recipes/r1').set(validRecipe({ servings: 0 })));
    await assertFails(as(OWNER).doc('recipes/r2').set(validRecipe({ timesCooked: -1 })));
  });

  it('allows incrementing timesCooked', async () => {
    const recipe = validRecipe();
    await seed((db) => db.doc('recipes/r1').set(recipe));

    await assertSucceeds(
      as(OWNER).doc('recipes/r1').update({
        createdAt: recipe.createdAt,
        name: recipe.name,
        timesCooked: 1,
      })
    );
  });

  it('refuses to let a recipe be renamed or its creation date rewritten', async () => {
    const recipe = validRecipe();
    await seed((db) => db.doc('recipes/r1').set(recipe));

    await assertFails(
      as(OWNER).doc('recipes/r1').update({ createdAt: recipe.createdAt, name: 'Something Else' })
    );
  });

  it('only allows deleting user-created recipes', async () => {
    await seed((db) => db.doc('recipes/mine').set(validRecipe({ source: 'user-created' })));
    await seed((db) => db.doc('recipes/synced').set(validRecipe({ source: 'legacy' })));

    await assertSucceeds(as(OWNER).doc('recipes/mine').delete());
    await assertFails(as(OWNER).doc('recipes/synced').delete());
  });
});

// ---------------------------------------------------------------------------
// syncMetadata + default deny
// ---------------------------------------------------------------------------

describe('syncMetadata', () => {
  it('is readable by signed-in users so the sync dashboard can show status', async () => {
    await seed((db) => db.doc('syncMetadata/recipesSync').set({ syncStatus: 'pending' }));
    await assertSucceeds(as(OWNER).doc('syncMetadata/recipesSync').get());
  });

  it('is never writable from the client — only Cloud Functions may update it', async () => {
    await assertFails(as(OWNER).doc('syncMetadata/recipesSync').set({ syncStatus: 'complete' }));
  });
});

describe('default deny', () => {
  it('blocks reads and writes to collections the rules do not mention', async () => {
    await assertFails(as(OWNER).doc('somethingElse/doc-1').set({ anything: true }));
    await assertFails(as(OWNER).doc('somethingElse/doc-1').get());
  });
});
