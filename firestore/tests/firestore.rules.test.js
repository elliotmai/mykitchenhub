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
  purchaseHistory: [
    { addedAt: new Date().toISOString(), quantity: 1, unit: 'gal', price: 4.29, store: 'Costco' },
  ],
  totalTimesPurchased: 1,
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

// The document both CSV importers build — src/hooks/useCSVImport.js
// buildInventoryDoc and functions/src/csvImport/importInventoryFromCSV.js
// buildInventoryDoc. Kept whole, extra fields included, because the rules see
// the whole document: a field neither layer is allowed to write is exactly the
// kind of drift this suite exists to catch.
const validImportedItem = (overrides = {}) => ({
  name: 'Whole Milk',
  normalized: 'whole milk',
  quantity: 2,
  unit: 'gal',
  locationId: 'loc-1',
  locationType: 'fridge',
  addedAt: new Date().toISOString(),
  expiresAt: new Date().toISOString(),
  shelfLifeDays: 7,
  notes: '',
  source: 'csv-import',
  purchaseHistory: [
    { addedAt: new Date().toISOString(), quantity: 2, unit: 'gal', price: null, store: '' },
  ],
  totalTimesPurchased: 1,
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

const validNotification = (overrides = {}) => ({
  type: 'waste-alert',
  title: '2 items to use up soon',
  body: 'spinach (today) and milk (tomorrow).',
  createdAt: new Date().toISOString(),
  read: false,
  channel: 'in-app',
  smsStatus: 'not-configured',
  itemIds: ['item-1'],
  itemCount: 2,
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

// The document useShoppingList.buildShoppingItem produces, field for field,
// plus the serverTimestamp() the hook adds on the way out. Manual shopping
// items carry no `haveInInventory` or `onHand` — those belong to derived rows,
// which have no documents at all.
const validShoppingItem = (overrides = {}) => ({
  name: 'Batteries',
  normalized: 'batteries',
  quantity: 1,
  unit: '',
  notes: '',
  status: 'pending',
  source: 'manual',
  createdAt: new Date().toISOString(),
  boughtAt: null,
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

  it("stops a user creating a profile under someone else's id", async () => {
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
      as(OWNER)
        .doc(`users/${OWNER}`)
        .update({ createdAt: profile.createdAt, email: 'new@example.com' })
    );
    await assertFails(
      as(OWNER).doc(`users/${OWNER}`).update({ createdAt: '1999-01-01', email: profile.email })
    );
  });

  it('never allows profile deletion from the client', async () => {
    await seed((db) => db.doc(`users/${OWNER}`).set(validUser()));
    await assertFails(as(OWNER).doc(`users/${OWNER}`).delete());
  });

  // -------------------------------------------------------------------------
  // 10.2 — update must not be a way around create's field check. A `setDoc`
  // without `{ merge: true }` replaces the document, so without the same
  // `hasRequiredFields` guard on update, a profile could reach a state that
  // `create` would have refused outright.
  // -------------------------------------------------------------------------

  it('refuses an update that strips preferences off the profile', async () => {
    const profile = validUser();
    await seed((db) => db.doc(`users/${OWNER}`).set(profile));

    // Every immutable field is honoured here — only `preferences` is missing,
    // and that alone must be enough to refuse the write.
    const { preferences, ...withoutPreferences } = profile;
    await assertFails(as(OWNER).doc(`users/${OWNER}`).set(withoutPreferences));
  });

  it('refuses an update that empties the profile down to its immutable fields', async () => {
    const profile = validUser();
    await seed((db) => db.doc(`users/${OWNER}`).set(profile));

    await assertFails(
      as(OWNER)
        .doc(`users/${OWNER}`)
        .set({ email: profile.email, createdAt: profile.createdAt })
    );
  });

  it('still lets a profile written by onUserCreate be updated', async () => {
    // The Cloud Function writes helloFresh nested under `preferences` and no
    // top-level key, and the admin SDK bypasses these rules — so profiles
    // shaped like this exist. Requiring a top-level `helloFresh` on update
    // would freeze every one of them, including the write useDeliveries makes
    // to add that very key. Rejecting a legitimate write is the worse failure.
    const { helloFresh, ...asOnUserCreateWritesIt } = validUser();
    await seed((db) => db.doc(`users/${OWNER}`).set(asOnUserCreateWritesIt));

    await assertSucceeds(
      as(OWNER).doc(`users/${OWNER}`).update({ displayName: 'Chef Eli' })
    );
    await assertSucceeds(
      as(OWNER).doc(`users/${OWNER}`).update({ 'helloFresh.enabled': true })
    );
  });

  it('lets a partial merge through, because the merged result is still whole', async () => {
    const profile = validUser();
    await seed((db) => db.doc(`users/${OWNER}`).set(profile));

    await assertSucceeds(
      as(OWNER).doc(`users/${OWNER}`).set({ displayName: 'Chef Eli' }, { merge: true })
    );
  });
});

// ---------------------------------------------------------------------------
// The client-side signup fallback — roadmap 9.4, against 10.2's rules
//
// When the onUserCreated Cloud Function cannot be reached, signup provisions
// the kitchen from the browser instead (src/hooks/useAuth.js,
// createUserProfile). That is the one write path a cook cannot retry for
// themselves: if it is refused they are left holding an auth account with no
// profile behind it, and signing up again just says the email is taken.
//
// Firestore is still in test mode, so a violating write from that path
// succeeds in production today and starts failing the moment step 10.2 lands.
// These fixtures mirror the payloads that code actually builds — field for
// field, extras included, because the rules see the whole document. If the
// hook changes, these change with it; if they then fail, the hook is writing
// something production will refuse.
// ---------------------------------------------------------------------------

/** The user document the fallback writes. Mirrors `fallbackData` in useAuth.js. */
const fallbackProfile = (overrides = {}) => ({
  email: 'new@example.com',
  displayName: 'new',
  createdAt: new Date().toISOString(),
  preferences: {
    smsAlerts: { enabled: false, phoneNumber: '', time: '09:00' },
    notifications: { expiringSoon: true, mealPlanReminders: true, lowInventory: false },
    dietary: { restrictions: [], preferences: [], allergies: [] },
  },
  // Top level, not nested under preferences: the create rule lists `helloFresh`
  // among the fields a user document must have.
  helloFresh: { linked: false, deliveryDays: [1, 3, 5] },
  stats: { totalRecipes: 0, totalItems: 0, wasteReduction: 0 },
  ...overrides,
});

/** The four shelves the fallback writes. Mirrors `defaultLocations` in useAuth.js. */
const FALLBACK_LOCATIONS = [
  { label: 'Main Fridge', type: 'fridge', icon: '🧊', color: '#3498db', order: 1 },
  { label: 'Freezer', type: 'freezer', icon: '❄️', color: '#9b59b6', order: 2 },
  { label: 'Pantry', type: 'pantry', icon: '🏺', color: '#e67e22', order: 3 },
  { label: 'Counter', type: 'pantry', icon: '🍞', color: '#f39c12', order: 4 },
];

const fallbackLocationDoc = (location) => ({
  ...location,
  isDefault: true,
  itemCount: 0,
  createdAt: new Date().toISOString(),
});

describe('signup fallback when the Cloud Function is unreachable', () => {
  const NEW_COOK = 'user-brand-new';

  it('lands a complete profile the rules accept', async () => {
    await assertSucceeds(as(NEW_COOK).doc(`users/${NEW_COOK}`).set(fallbackProfile()));
  });

  it('lands all four default shelves', async () => {
    for (const location of FALLBACK_LOCATIONS) {
      const id = `${location.type}_${location.order}`;
      await assertSucceeds(
        as(NEW_COOK)
          .doc(`users/${NEW_COOK}/storageLocations/${id}`)
          .set(fallbackLocationDoc(location))
      );
    }
  });

  it('gives the four shelves four distinct ids, so none overwrites another', () => {
    // Two of them are `type: 'pantry'`, so the id has to carry the order as
    // well — `pantry_3` and `pantry_4`. A collision here would leave a new cook
    // with three shelves and no error anywhere.
    const ids = FALLBACK_LOCATIONS.map((l) => `${l.type}_${l.order}`);
    expect(new Set(ids).size).toBe(FALLBACK_LOCATIONS.length);
  });

  it('leaves a kitchen that can be read back and put food into', async () => {
    await assertSucceeds(as(NEW_COOK).doc(`users/${NEW_COOK}`).set(fallbackProfile()));
    await assertSucceeds(
      as(NEW_COOK)
        .doc(`users/${NEW_COOK}/storageLocations/fridge_1`)
        .set(fallbackLocationDoc(FALLBACK_LOCATIONS[0]))
    );

    await assertSucceeds(as(NEW_COOK).doc(`users/${NEW_COOK}`).get());
    // The first thing a cook does with a new kitchen is put food in one of the
    // shelves this path just created.
    await assertSucceeds(
      as(NEW_COOK)
        .doc(`users/${NEW_COOK}/inventory/first-item`)
        .set(validItem({ locationId: 'fridge_1', locationType: 'fridge' }))
    );
  });

  // -------------------------------------------------------------------------
  // The shapes this path used to write, which the tests above guard against
  // coming back. Each one leaves a cook stranded under production rules.
  // -------------------------------------------------------------------------

  it('would have been refused with helloFresh nested under preferences', async () => {
    const { helloFresh, ...rest } = fallbackProfile();
    await assertFails(
      as(NEW_COOK)
        .doc(`users/${NEW_COOK}`)
        .set({ ...rest, preferences: { ...rest.preferences, helloFresh } })
    );
  });

  it('would have been refused with shelves keyed `name` instead of `label`', async () => {
    const { label, ...rest } = fallbackLocationDoc(FALLBACK_LOCATIONS[0]);
    await assertFails(
      as(NEW_COOK)
        .doc(`users/${NEW_COOK}/storageLocations/fridge_1`)
        .set({ ...rest, name: label })
    );
  });

  it('cannot provision a kitchen under somebody else’s id', async () => {
    await assertFails(as(INTRUDER).doc(`users/${NEW_COOK}`).set(fallbackProfile()));
    await assertFails(
      as(INTRUDER)
        .doc(`users/${NEW_COOK}/storageLocations/fridge_1`)
        .set(fallbackLocationDoc(FALLBACK_LOCATIONS[0]))
    );
  });

  // -------------------------------------------------------------------------
  // Retrying it
  //
  // The fallback is reached only after withRetry has already tried the function
  // three times, and its own writes can be re-run: a cook who taps "Sign up"
  // again on a flaky connection walks the same path a second time. Re-sending
  // the identical payload must not be refused, or a recoverable failure
  // becomes a permanent one.
  // -------------------------------------------------------------------------

  it('can be re-run with the same payload without being refused', async () => {
    const profile = fallbackProfile();
    const shelf = fallbackLocationDoc(FALLBACK_LOCATIONS[0]);

    await assertSucceeds(as(NEW_COOK).doc(`users/${NEW_COOK}`).set(profile));
    await assertSucceeds(as(NEW_COOK).doc(`users/${NEW_COOK}`).set(profile));

    await assertSucceeds(
      as(NEW_COOK).doc(`users/${NEW_COOK}/storageLocations/fridge_1`).set(shelf)
    );
    await assertSucceeds(
      as(NEW_COOK).doc(`users/${NEW_COOK}/storageLocations/fridge_1`).set(shelf)
    );
  });

  it('is refused on a re-run that restamps createdAt — which is why it must not', async () => {
    // The update rule pins createdAt and email. A second attempt that rebuilds
    // the payload from scratch — a fresh serverTimestamp() rather than the one
    // already stored — is a *different* document to the rules, and is refused
    // even though the first attempt was allowed.
    //
    // This is the trap a retry falls into, and the reason createUserProfile
    // must not rewrite a profile that already exists. See the
    // "does not overwrite a profile the Cloud Function already created" case
    // in src/hooks/__tests__/useAuth.test.jsx.
    const profile = fallbackProfile();
    await seed((db) => db.doc(`users/${NEW_COOK}`).set(profile));

    await assertFails(
      as(NEW_COOK)
        .doc(`users/${NEW_COOK}`)
        .set({ ...profile, createdAt: new Date(Date.now() + 60_000).toISOString() })
    );
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
    await assertFails(
      as(OWNER)
        .doc(locPath(OWNER))
        .set({ ...rest, name: 'Main Fridge' })
    );
  });

  it.each(['fridge', 'freezer', 'pantry'])('accepts the %s location type', async (type) => {
    await assertSucceeds(
      as(OWNER)
        .doc(locPath(OWNER, `loc-${type}`))
        .set(validLocation({ type }))
    );
  });

  it('rejects an unknown location type', async () => {
    await assertFails(
      as(OWNER)
        .doc(locPath(OWNER))
        .set(validLocation({ type: 'garage' }))
    );
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

  // 10.2 — the guard above is only worth having if `isDefault` cannot be
  // cleared first. Two writes would otherwise delete any location at all.
  it('refuses to let a default location be un-defaulted', async () => {
    await seed((db) => db.doc(locPath(OWNER)).set(validLocation({ isDefault: true })));
    await assertFails(as(OWNER).doc(locPath(OWNER)).update({ isDefault: false }));
  });

  it('accepts the rename the edit form sends', async () => {
    const location = validLocation({ isDefault: true });
    await seed((db) => db.doc(locPath(OWNER)).set(location));

    // AddLocationModal submits exactly these four fields.
    await assertSucceeds(
      as(OWNER)
        .doc(locPath(OWNER))
        .update({ label: 'Garage Fridge', type: 'fridge', icon: '🚗', color: '#1abc9c' })
    );
  });

  it('refuses an update that strips the label the UI renders', async () => {
    await seed((db) => db.doc(locPath(OWNER)).set(validLocation()));

    const { label, ...withoutLabel } = validLocation();
    await assertFails(as(OWNER).doc(locPath(OWNER)).set(withoutLabel));
  });

  it('rejects an unknown location type on update', async () => {
    await seed((db) => db.doc(locPath(OWNER)).set(validLocation()));
    await assertFails(as(OWNER).doc(locPath(OWNER)).update({ type: 'garage' }));
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
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set({ ...rest, addedBy: 'manual' })
    );
  });

  it.each(['manual', 'hellofresh', 'csv-import', 'seed'])('accepts source "%s"', async (source) => {
    await assertSucceeds(
      as(OWNER)
        .doc(itemPath(OWNER, `item-${source}`))
        .set(validItem({ source }))
    );
  });

  it('rejects an unrecognised source', async () => {
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validItem({ source: 'telepathy' }))
    );
  });

  it('accepts the document shape the CSV importer writes', async () => {
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER, 'csv-1')).set(validImportedItem()));
  });

  it.each(['fridge', 'freezer', 'pantry'])(
    'accepts a CSV row resolved to a %s location',
    async (locationType) => {
      await assertSucceeds(
        as(OWNER)
          .doc(itemPath(OWNER, `csv-${locationType}`))
          .set(validImportedItem({ locationType }))
      );
    }
  );

  it('rejects an imported item with a quantity the validator should have caught', async () => {
    // Belt and braces: both csvValidation copies reject "0", and if one ever
    // stops, the database still will.
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validImportedItem({ quantity: 0 }))
    );
  });

  it('rejects an imported item missing the fields the importer promises', async () => {
    const { normalized, ...withoutNormalized } = validImportedItem();
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set(withoutNormalized));
  });

  it("keeps one user's import out of another user's inventory", async () => {
    await assertFails(as(INTRUDER).doc(itemPath(OWNER, 'csv-2')).set(validImportedItem()));
  });

  it('requires a positive quantity on create', async () => {
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validItem({ quantity: 0 }))
    );
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validItem({ quantity: -3 }))
    );
  });

  it('allows an update to zero quantity, for a used-up item', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    await assertSucceeds(
      as(OWNER).doc(itemPath(OWNER)).update({ addedAt: item.addedAt, quantity: 0 })
    );
  });

  it('rejects a negative quantity on update', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    await assertFails(
      as(OWNER).doc(itemPath(OWNER)).update({ addedAt: item.addedAt, quantity: -1 })
    );
  });

  it('refuses to let the added date be rewritten', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    await assertFails(
      as(OWNER).doc(itemPath(OWNER)).update({ addedAt: '1999-01-01', quantity: 2 })
    );
  });

  it('accepts a restock: another purchase appended and the counters bumped', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    await assertSucceeds(
      as(OWNER)
        .doc(itemPath(OWNER))
        .update({
          addedAt: item.addedAt,
          quantity: item.quantity + 2,
          totalTimesPurchased: 2,
          purchaseHistory: [
            ...item.purchaseHistory,
            {
              addedAt: new Date().toISOString(),
              quantity: 2,
              unit: 'gal',
              price: 3.99,
              store: 'Aldi',
            },
          ],
        })
    );
  });

  // "Mark as Cooked" is the one place the meal plan writes to the kitchen. It
  // patches `quantity` and nothing else, which is what keeps it inside the
  // addedAt rule — see markCooked in src/hooks/useMealPlan.js.
  it('accepts the quantity-only patch marking a meal cooked makes', async () => {
    await seed((db) => db.doc(itemPath(OWNER, 'cooked-from')).set(validItem({ quantity: 5 })));

    await assertSucceeds(as(OWNER).doc(itemPath(OWNER, 'cooked-from')).update({ quantity: 3 }));
  });

  it('accepts a decrement that empties the jar, but not one that goes past it', async () => {
    await seed((db) => db.doc(itemPath(OWNER, 'last-of-it')).set(validItem({ quantity: 2 })));

    // planInventoryDecrements floors at zero for exactly this reason.
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER, 'last-of-it')).update({ quantity: 0 }));
    await assertFails(as(OWNER).doc(itemPath(OWNER, 'last-of-it')).update({ quantity: -1 }));
  });

  it('rejects an unknown location type', async () => {
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validItem({ locationType: 'garage' }))
    );
  });

  // 10.2 — create validated these; before production rules, update did not, so
  // every constraint was one edit away from being bypassed.
  it('rejects an unknown location type on update', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validItem()));
    await assertFails(as(OWNER).doc(itemPath(OWNER)).update({ locationType: 'garage' }));
  });

  it('rejects an unrecognised source on update', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validItem()));
    await assertFails(as(OWNER).doc(itemPath(OWNER)).update({ source: 'mystery' }));
  });

  it('refuses an update that strips a required field', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    const { normalized, ...withoutNormalized } = item;
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set(withoutNormalized));
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
  it.each(['default', 'custom'])('accepts shelfLifeSource "%s"', async (shelfLifeSource) => {
    await assertSucceeds(
      as(OWNER)
        .doc(itemPath(OWNER, `item-${shelfLifeSource}`))
        .set(validItem({ shelfLifeDays: 7, shelfLifeSource }))
    );
  });

  it('accepts the freeze write: a new location, expiry and shelf life at once', async () => {
    const item = validItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    // What "Freeze All" sends — the whole point of it is the longer expiry.
    await assertSucceeds(
      as(OWNER)
        .doc(itemPath(OWNER))
        .update({
          addedAt: item.addedAt,
          quantity: item.quantity,
          locationId: 'loc-freezer',
          locationType: 'freezer',
          shelfLifeDays: 90,
          shelfLifeSource: 'default',
          expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
        })
    );
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
      as(OWNER)
        .doc(importPath(OWNER, `import-${status}`))
        .set(validImportRecord({ status }))
    );
  });

  it('rejects an unrecognised status or source', async () => {
    await assertFails(
      as(OWNER)
        .doc(importPath(OWNER))
        .set(validImportRecord({ status: 'ok' }))
    );
    await assertFails(
      as(OWNER)
        .doc(importPath(OWNER))
        .set(validImportRecord({ source: 'manual' }))
    );
  });

  it('rejects negative counts', async () => {
    await assertFails(
      as(OWNER)
        .doc(importPath(OWNER))
        .set(validImportRecord({ itemsImported: -1 }))
    );
    await assertFails(
      as(OWNER)
        .doc(importPath(OWNER))
        .set(validImportRecord({ itemsSkipped: -1 }))
    );
  });

  it('accepts a run that logged nothing wrong and one that logged the full 20', async () => {
    // MAX_LOGGED_ERRORS in both importers caps the array at 20; the rules must
    // take both ends of that.
    await assertSucceeds(
      as(OWNER)
        .doc(importPath(OWNER, 'import-clean'))
        .set(validImportRecord({ errorCount: 0, errors: [] }))
    );
    await assertSucceeds(
      as(OWNER)
        .doc(importPath(OWNER, 'import-noisy'))
        .set(
          validImportRecord({
            errorCount: 57,
            errors: Array.from({ length: 20 }, (_, i) => ({
              row: i + 2,
              message: 'Missing quantity.',
            })),
          })
        )
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

// ---------------------------------------------------------------------------
// users/{userId}/mealPlanEntries/{entryId}
//
// Phase 5 (HelloFresh) and Phase 6 (waste prevention) both write into this
// collection, so these cases are the shared contract, not just Phase 7's.
// ---------------------------------------------------------------------------

describe('notifications', () => {
  const notificationPath = (uid, id = 'waste-alert-2026-08-14') =>
    `users/${uid}/notifications/${id}`;

  it('accepts the document shape the daily waste alert writes', async () => {
    await assertSucceeds(as(OWNER).doc(notificationPath(OWNER)).set(validNotification()));
  });

  it('requires the fields the notification list renders', async () => {
    const { title, ...withoutTitle } = validNotification();
    await assertFails(as(OWNER).doc(notificationPath(OWNER)).set(withoutTitle));
  });

  it.each(['waste-alert', 'meal-plan', 'system'])('accepts type "%s"', async (type) => {
    await assertSucceeds(
      as(OWNER)
        .doc(notificationPath(OWNER, `n-${type}`))
        .set(validNotification({ type }))
    );
  });

  it('rejects an unrecognised notification type', async () => {
    await assertFails(
      as(OWNER)
        .doc(notificationPath(OWNER))
        .set(validNotification({ type: 'spam' }))
    );
  });

  it('lets the owner mark one as read', async () => {
    const notification = validNotification();
    await seed((db) => db.doc(notificationPath(OWNER)).set(notification));

    await assertSucceeds(
      as(OWNER)
        .doc(notificationPath(OWNER))
        .update({ createdAt: notification.createdAt, read: true })
    );
  });

  it('refuses to let marking as read restamp when the alert arrived', async () => {
    await seed((db) => db.doc(notificationPath(OWNER)).set(validNotification()));

    await assertFails(
      as(OWNER).doc(notificationPath(OWNER)).update({ createdAt: '1999-01-01', read: true })
    );
  });

  it('refuses to let marking as read empty out the alert or change its type', async () => {
    const notification = validNotification();
    await seed((db) => db.doc(notificationPath(OWNER)).set(notification));

    await assertFails(as(OWNER).doc(notificationPath(OWNER)).update({ type: 'promotion' }));

    const { body, ...withoutBody } = notification;
    await assertFails(as(OWNER).doc(notificationPath(OWNER)).set(withoutBody));
  });

  it('lets the owner dismiss one', async () => {
    await seed((db) => db.doc(notificationPath(OWNER)).set(validNotification()));
    await assertSucceeds(as(OWNER).doc(notificationPath(OWNER)).delete());
  });

  it("keeps one user out of another user's alerts", async () => {
    await seed((db) => db.doc(notificationPath(OWNER)).set(validNotification()));

    await assertFails(as(INTRUDER).doc(notificationPath(OWNER)).get());
    await assertFails(as(INTRUDER).doc(notificationPath(OWNER)).delete());
    await assertFails(anon().doc(notificationPath(OWNER)).get());
  });
});

// ---------------------------------------------------------------------------
// users/{userId}/mealPlan/{entryId} — written by "Add to Meal Plan"
// ---------------------------------------------------------------------------

describe('hellofresh deliveries', () => {
  const path = (uid, id = 'delivery-1') => `users/${uid}/deliveries/${id}`;

  it('accepts the document shape the Add Delivery workflow writes', async () => {
    await assertSucceeds(as(OWNER).doc(path(OWNER)).set(validDelivery()));
  });

  it.each(['deliveredAt', 'source', 'status', 'recipeIds', 'mealCount', 'itemsAdded', 'createdAt'])(
    'requires %s',
    async (field) => {
      const doc = validDelivery();
      delete doc[field];
      await assertFails(as(OWNER).doc(path(OWNER)).set(doc));
    }
  );

  it.each(['scheduled', 'received', 'cooked'])('accepts status "%s"', async (status) => {
    await assertSucceeds(
      as(OWNER)
        .doc(path(OWNER, `d-${status}`))
        .set(validDelivery({ status }))
    );
  });

  it('rejects an unrecognised status', async () => {
    await assertFails(
      as(OWNER)
        .doc(path(OWNER))
        .set(validDelivery({ status: 'in-transit' }))
    );
  });

  it('only accepts hellofresh as the source', async () => {
    await assertFails(
      as(OWNER)
        .doc(path(OWNER))
        .set(validDelivery({ source: 'manual' }))
    );
  });

  it('rejects negative counts', async () => {
    await assertFails(
      as(OWNER)
        .doc(path(OWNER))
        .set(validDelivery({ mealCount: -1 }))
    );
    await assertFails(
      as(OWNER)
        .doc(path(OWNER, 'd2'))
        .set(validDelivery({ itemsAdded: -1 }))
    );
  });

  it('allows an empty box — a delivery logged before its recipes were imported', async () => {
    await assertSucceeds(
      as(OWNER)
        .doc(path(OWNER))
        .set(validDelivery({ mealCount: 0, itemsAdded: 0, recipeIds: [] }))
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

  // 10.2 — create pinned `source` to hellofresh; update has to as well, or a
  // delivery can be relabelled out of the history that owns it.
  it('refuses to let a delivery be relabelled away from hellofresh', async () => {
    await seed((db) => db.doc(path(OWNER)).set(validDelivery()));
    await assertFails(as(OWNER).doc(path(OWNER)).update({ source: 'manual' }));
  });

  it('refuses an update that strips the counts the history renders', async () => {
    const delivery = validDelivery();
    await seed((db) => db.doc(path(OWNER)).set(delivery));

    const { itemsAdded, ...withoutItemsAdded } = delivery;
    await assertFails(as(OWNER).doc(path(OWNER)).set(withoutItemsAdded));
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

  it('accepts the document the waste-prevention button writes, field for field', async () => {
    // Transcribed from `addToMealPlan` in src/hooks/useRecipeSuggestions.js.
    // The fixture above is Phase 7's own shape; this collection is written by
    // Phase 6 as well, and a cross-phase writer is exactly the kind that
    // drifts without anybody noticing until the rules go into production
    // mode. `createdAt` is a serverTimestamp() in the app — a Timestamp here.
    await assertSucceeds(
      as(OWNER)
        .doc(entryPath(OWNER, 'from-waste-alerts'))
        .set({
          date: '2026-08-15',
          mealType: 'dinner',
          recipeId: 'recipe-1',
          recipeName: 'Creamed Spinach',
          servings: 2,
          status: 'planned',
          source: 'waste-prevention',
          createdAt: new Date(),
          cookedAt: null,
          usesIngredients: [{ name: 'Spinach', normalized: 'spinach', quantity: 1, unit: 'bag' }],
          batchGroup: null,
          notes: '',
          planId: null,
        })
    );
  });

  it('requires `recipeName` — an entry carrying only a recipeId is rejected', async () => {
    const { recipeName, ...rest } = validMealPlanEntry();
    await assertFails(as(OWNER).doc(entryPath(OWNER)).set(rest));
  });

  it('insists `date` is a YYYY-MM-DD string, not a Timestamp', async () => {
    await assertFails(
      as(OWNER)
        .doc(entryPath(OWNER))
        .set(validMealPlanEntry({ date: new Date() }))
    );
    await assertFails(
      as(OWNER)
        .doc(entryPath(OWNER))
        .set(validMealPlanEntry({ date: '15/08/2026' }))
    );
    await assertFails(
      as(OWNER)
        .doc(entryPath(OWNER))
        .set(validMealPlanEntry({ date: '2026-8-5' }))
    );
  });

  it.each(['breakfast', 'lunch', 'dinner', 'snack'])('accepts mealType "%s"', async (mealType) => {
    await assertSucceeds(
      as(OWNER)
        .doc(entryPath(OWNER, `entry-${mealType}`))
        .set(validMealPlanEntry({ mealType }))
    );
  });

  it('rejects an unrecognised meal type', async () => {
    await assertFails(
      as(OWNER)
        .doc(entryPath(OWNER))
        .set(validMealPlanEntry({ mealType: 'brunch' }))
    );
  });

  it.each(['manual', 'ai', 'hellofresh', 'waste-prevention'])(
    'accepts source "%s" — every feature that schedules meals',
    async (source) => {
      await assertSucceeds(
        as(OWNER)
          .doc(entryPath(OWNER, `entry-${source}`))
          .set(validMealPlanEntry({ source }))
      );
    }
  );

  it('rejects an unrecognised source', async () => {
    await assertFails(
      as(OWNER)
        .doc(entryPath(OWNER))
        .set(validMealPlanEntry({ source: 'guesswork' }))
    );
  });

  it.each(['planned', 'cooked', 'skipped'])('accepts status "%s"', async (status) => {
    await assertSucceeds(
      as(OWNER)
        .doc(entryPath(OWNER, `entry-${status}`))
        .set(validMealPlanEntry({ status }))
    );
  });

  it('rejects an unrecognised status', async () => {
    await assertFails(
      as(OWNER)
        .doc(entryPath(OWNER))
        .set(validMealPlanEntry({ status: 'burnt' }))
    );
  });

  it('requires a positive serving count', async () => {
    await assertFails(
      as(OWNER)
        .doc(entryPath(OWNER))
        .set(validMealPlanEntry({ servings: 0 }))
    );
    await assertFails(
      as(OWNER)
        .doc(entryPath(OWNER))
        .set(validMealPlanEntry({ servings: -2 }))
    );
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

  // 10.2 — a reschedule must not be able to empty the card it moves.
  it('refuses an update that strips the recipe name the day card renders', async () => {
    const entry = validMealPlanEntry();
    await seed((db) => db.doc(entryPath(OWNER)).set(entry));

    const { recipeName, ...withoutRecipeName } = entry;
    await assertFails(as(OWNER).doc(entryPath(OWNER)).set(withoutRecipeName));
  });

  it('rejects an unrecognised source on update', async () => {
    await seed((db) => db.doc(entryPath(OWNER)).set(validMealPlanEntry()));
    await assertFails(as(OWNER).doc(entryPath(OWNER)).update({ source: 'mystery' }));
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

  // Copied from the "Writing an entry from another feature" block in
  // SCHEMA_DOCUMENTATION.md. If this stops passing, that snippet is a lie and
  // Phase 5 and Phase 6 will find out the hard way.
  const documentedForeignWrite = (source) => ({
    date: '2026-08-15',
    mealType: 'dinner',
    recipeId: 'recipe-abc',
    recipeName: 'Sheet Pan Salmon',
    servings: 2,
    status: 'planned',
    source,
    createdAt: new Date().toISOString(),
    cookedAt: null,
    usesIngredients: [],
    batchGroup: null,
    notes: '',
    planId: null,
  });

  it.each(['hellofresh', 'waste-prevention'])(
    'accepts the write the schema documents for a %s meal, field for field',
    async (source) => {
      await assertSucceeds(
        as(OWNER)
          .doc(entryPath(OWNER, `doc-${source}`))
          .set(documentedForeignWrite(source))
      );
    }
  );

  it('lets a meal another feature scheduled be marked cooked here', async () => {
    const entry = documentedForeignWrite('hellofresh');
    await seed((db) => db.doc(entryPath(OWNER, 'hf-cook')).set(entry));

    await assertSucceeds(
      as(OWNER)
        .doc(entryPath(OWNER, 'hf-cook'))
        .update({ status: 'cooked', cookedAt: new Date().toISOString() })
    );
  });

  it('lets a meal another feature scheduled be dragged to another day', async () => {
    const entry = documentedForeignWrite('waste-prevention');
    await seed((db) => db.doc(entryPath(OWNER, 'wp-move')).set(entry));

    // The reschedule patch is `{ date }` alone — no createdAt, which is exactly
    // what the rule pins.
    await assertSucceeds(as(OWNER).doc(entryPath(OWNER, 'wp-move')).update({ date: '2026-08-17' }));
  });

  it('lets a meal be skipped, which the schema allows and the board renders', async () => {
    await seed((db) => db.doc(entryPath(OWNER, 'skip')).set(validMealPlanEntry()));
    await assertSucceeds(as(OWNER).doc(entryPath(OWNER, 'skip')).update({ status: 'skipped' }));
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
    await assertFails(
      as(OWNER)
        .doc(planPath(OWNER))
        .set(validMealPlan({ weekStart: new Date() }))
    );
    await assertFails(
      as(OWNER)
        .doc(planPath(OWNER))
        .set(validMealPlan({ weekStart: 'week of Aug 10' }))
    );
  });

  it.each(['ai', 'manual'])('accepts source "%s"', async (source) => {
    await assertSucceeds(
      as(OWNER)
        .doc(planPath(OWNER, `p-${source}`))
        .set(validMealPlan({ source }))
    );
  });

  it('rejects an unrecognised plan source', async () => {
    await assertFails(
      as(OWNER)
        .doc(planPath(OWNER))
        .set(validMealPlan({ source: 'hellofresh' }))
    );
  });

  it.each(['draft', 'active', 'archived'])('accepts status "%s"', async (status) => {
    await assertSucceeds(
      as(OWNER)
        .doc(planPath(OWNER, `p-${status}`))
        .set(validMealPlan({ status }))
    );
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

  // These two mirror generatePlan() in src/hooks/useMealPlan.js exactly. The
  // hook writes the week with setDoc({ merge: true }); the difference between
  // them is whether that payload carries a fresh createdAt.
  it('accepts the merge write the app makes for a brand new week', async () => {
    const { createdAt, ...rest } = validMealPlan();

    await assertSucceeds(
      as(OWNER)
        .doc(planPath(OWNER, 'new-week'))
        .set({ ...rest, createdAt: new Date().toISOString() }, { merge: true })
    );
  });

  it('accepts the merge write the app makes when regenerating an existing week', async () => {
    const existing = validMealPlan();
    await seed((db) => db.doc(planPath(OWNER, 'existing-week')).set(existing));

    // No createdAt in the payload: merge leaves the stored one in place, which
    // is the only way past `request.resource.data.createdAt == resource.data.createdAt`.
    const { createdAt, ...regenerated } = validMealPlan({ notes: 'Second try.' });

    await assertSucceeds(
      as(OWNER).doc(planPath(OWNER, 'existing-week')).set(regenerated, { merge: true })
    );
  });

  it('refuses a regeneration that re-stamps createdAt, as the app used to', async () => {
    await seed((db) => db.doc(planPath(OWNER, 'restamped')).set(validMealPlan()));

    // Firestore's test mode lets this through today. Once step 10.2 turns
    // production rules on, it is the difference between "Regenerate plan"
    // working and failing every time.
    await assertFails(
      as(OWNER)
        .doc(planPath(OWNER, 'restamped'))
        .set(
          { ...validMealPlan(), createdAt: new Date(Date.now() + 1000).toISOString() },
          { merge: true }
        )
    );
  });

  it('takes the onHand field the shopping list now carries', async () => {
    await assertSucceeds(
      as(OWNER)
        .doc(planPath(OWNER, 'with-onhand'))
        .set(
          validMealPlan({
            shoppingList: [
              {
                name: 'salmon',
                normalized: 'salmon',
                quantity: 2,
                unit: 'fillet',
                onHand: 1,
                haveInInventory: false,
              },
            ],
          })
        )
    );
  });

  // 10.2 — regenerating a week rewrites most of the document; the four fields
  // that identify it must survive that.
  it('refuses a regeneration that drops the week it is for', async () => {
    const plan = validMealPlan();
    await seed((db) => db.doc(planPath(OWNER)).set(plan));

    const { weekStart, ...withoutWeekStart } = plan;
    await assertFails(as(OWNER).doc(planPath(OWNER)).set(withoutWeekStart));
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
    await assertFails(
      as(OWNER)
        .doc('recipes/r1')
        .set(validRecipe({ source: 'seed' }))
    );
  });

  it.each(['easy', 'medium', 'hard'])('accepts difficulty "%s"', async (difficulty) => {
    await assertSucceeds(as(OWNER).doc(`recipes/r-${difficulty}`).set(validRecipe({ difficulty })));
  });

  it('rejects an unrecognised difficulty', async () => {
    await assertFails(
      as(OWNER)
        .doc('recipes/r1')
        .set(validRecipe({ difficulty: 'impossible' }))
    );
  });

  it('requires a positive serving count and a non-negative cook count', async () => {
    await assertFails(
      as(OWNER)
        .doc('recipes/r1')
        .set(validRecipe({ servings: 0 }))
    );
    await assertFails(
      as(OWNER)
        .doc('recipes/r2')
        .set(validRecipe({ timesCooked: -1 }))
    );
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

  // ── Shapes Phase 4 actually writes ────────────────────────────────────────

  it('rejects a recipe keyed on `title` instead of `name`', async () => {
    const { name, ...rest } = validRecipe();
    await assertFails(
      as(OWNER)
        .doc('recipes/r1')
        .set({ ...rest, title: 'Sheet Pan Salmon' })
    );
  });

  it('accepts the document the Add Recipe form writes', async () => {
    await assertSucceeds(
      as(OWNER)
        .doc('recipes/from-the-form')
        .set(
          validRecipe({
            ingredients: [{ name: 'salmon', quantity: 2, unit: 'fillet', normalized: 'salmon' }],
            instructions: ['Heat the oven to 220C.', 'Roast for 15 minutes.'],
            prepTime: 5,
            cookTime: 15,
            imageUrl: 'https://storage.test/recipes/r1/salmon.jpg',
            createdBy: OWNER,
          })
        )
    );
  });

  it('accepts the document the legacy sync writes', async () => {
    await assertSucceeds(
      as(OWNER)
        .doc('recipes/from-the-sync')
        .set(
          validRecipe({
            source: 'legacy',
            legacyId: 'lets-eat-abc123',
            sourceId: 'spoonacular-12345',
            tags: ['dinner', 'legacy', 'spoonacular-instructions'],
            difficulty: 'medium',
            prepTime: null,
            cookTime: 25,
          })
        )
    );
  });

  it('accepts a recipe the sync could not write instructions for', async () => {
    await assertSucceeds(
      as(OWNER)
        .doc('recipes/needs-work')
        .set(
          validRecipe({
            source: 'legacy',
            tags: ['legacy', 'needs-instructions'],
            instructions: ['Instructions were not available in the original recipe.'],
          })
        )
    );
  });

  it('accepts the seeded recipes seedData writes', async () => {
    await assertSucceeds(
      as(OWNER)
        .doc('recipes/seeded')
        .set(
          validRecipe({
            name: 'Classic Spaghetti Carbonara',
            source: 'user-created',
            description: 'Traditional Italian pasta dish',
            createdBy: OWNER,
            prepTime: 10,
            cookTime: 20,
          })
        )
    );
  });

  it.each(['ingredients', 'instructions', 'tags', 'servings', 'difficulty', 'timesCooked'])(
    'rejects a recipe missing `%s`',
    async (field) => {
      const recipe = validRecipe();
      delete recipe[field];
      await assertFails(as(OWNER).doc('recipes/r1').set(recipe));
    }
  );

  it('lets a cook fix the servings or steps on their own recipe', async () => {
    const recipe = validRecipe();
    await seed((db) => db.doc('recipes/r1').set(recipe));

    await assertSucceeds(
      as(OWNER)
        .doc('recipes/r1')
        .update({
          servings: 6,
          instructions: ['Roast at 400F for 20 minutes.'],
          tags: ['dinner', 'weeknight'],
        })
    );
  });

  // Any signed-in cook may record that they made a legacy recipe, even though
  // they may not delete it.
  it('allows anyone to record a cook on a recipe they did not create', async () => {
    await seed((db) => db.doc('recipes/r1').set(validRecipe({ source: 'legacy' })));

    await assertSucceeds(as(INTRUDER).doc('recipes/r1').update({ timesCooked: 4 }));
  });

  it('only allows deleting user-created recipes', async () => {
    await seed((db) =>
      db.doc('recipes/mine').set(validRecipe({ source: 'user-created', createdBy: OWNER }))
    );
    await seed((db) => db.doc('recipes/synced').set(validRecipe({ source: 'legacy' })));

    await assertSucceeds(as(OWNER).doc('recipes/mine').delete());
    await assertFails(as(OWNER).doc('recipes/synced').delete());
  });

  // -------------------------------------------------------------------------
  // 10.2 — `recipes` is a shared library, so "you may only delete your own"
  // rests on `source` *and* `createdBy`. `source` alone says a cook wrote it,
  // not which cook: with only that check, any signed-in user could delete any
  // other cook's recipe. These are the tests that make that true.
  // -------------------------------------------------------------------------

  it("refuses to let one cook delete another cook's recipe", async () => {
    await seed((db) =>
      db.doc('recipes/mine').set(validRecipe({ source: 'user-created', createdBy: OWNER }))
    );

    await assertFails(as(INTRUDER).doc('recipes/mine').delete());

    // Still there, and still the owner's.
    const after = await as(OWNER).doc('recipes/mine').get();
    expect(after.exists).toBe(true);
    expect(after.data().createdBy).toBe(OWNER);
  });

  it('refuses to delete a user-created recipe that names no owner', async () => {
    // Seeded and legacy-synced recipes carry no `createdBy`. Nobody added them
    // from the app, so nobody may remove them for everyone else.
    await seed((db) => db.doc('recipes/seeded').set(validRecipe({ source: 'user-created' })));

    await assertFails(as(OWNER).doc('recipes/seeded').delete());
    await assertFails(as(INTRUDER).doc('recipes/seeded').delete());
  });

  it('refuses to let a cook file a new recipe under someone else’s name', async () => {
    // `createdBy` is what the delete rule trusts, so a create must not be able
    // to attribute a document to a cook who never wrote it.
    await assertFails(
      as(INTRUDER).doc('recipes/forged').set(validRecipe({ createdBy: OWNER }))
    );
  });

  it('accepts a create that claims the caller as author', async () => {
    await assertSucceeds(
      as(OWNER).doc('recipes/honest').set(validRecipe({ createdBy: OWNER }))
    );
  });

  it('still accepts a create that names no author at all', async () => {
    // Nothing in the app omits it today, but omitting it is not an attack —
    // it just produces a recipe the client cannot delete.
    await assertSucceeds(as(OWNER).doc('recipes/anon').set(validRecipe()));
  });

  it('refuses to let a recipe be relabelled as user-created', async () => {
    await seed((db) => db.doc('recipes/synced').set(validRecipe({ source: 'legacy' })));
    await assertFails(as(OWNER).doc('recipes/synced').update({ source: 'user-created' }));
  });

  it('closes the relabel-then-delete route into the legacy library', async () => {
    await seed((db) => db.doc('recipes/synced').set(validRecipe({ source: 'legacy' })));

    // Step one is refused, so step two never gets a document to delete.
    await assertFails(as(INTRUDER).doc('recipes/synced').update({ source: 'user-created' }));
    await assertFails(as(INTRUDER).doc('recipes/synced').delete());

    const after = await as(OWNER).doc('recipes/synced').get();
    expect(after.data().source).toBe('legacy');
  });

  it("refuses to let one cook take credit for another cook's recipe", async () => {
    await seed((db) =>
      db.doc('recipes/mine').set(validRecipe({ source: 'user-created', createdBy: OWNER }))
    );
    await assertFails(as(INTRUDER).doc('recipes/mine').update({ createdBy: INTRUDER }));
  });

  it('still accepts an edit to a recipe that carries no createdBy at all', async () => {
    // Legacy and seeded recipes have no `createdBy`; pinning it must not lock
    // them against editing.
    await seed((db) => db.doc('recipes/synced').set(validRecipe({ source: 'legacy' })));
    await assertSucceeds(as(OWNER).doc('recipes/synced').update({ servings: 6 }));
  });

  it('refuses an update that strips the fields the recipe view renders', async () => {
    const recipe = validRecipe();
    await seed((db) => db.doc('recipes/mine').set(recipe));

    const { instructions, ...withoutInstructions } = recipe;
    await assertFails(as(OWNER).doc('recipes/mine').set(withoutInstructions));
  });

  it('rejects an unrecognised difficulty on update', async () => {
    await seed((db) => db.doc('recipes/mine').set(validRecipe()));
    await assertFails(as(OWNER).doc('recipes/mine').update({ difficulty: 'expert' }));
  });
});

// ---------------------------------------------------------------------------
// syncMetadata + default deny
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// users/{userId}/shoppingItems/{itemId}
//
// The manual, ad-hoc part of the shopping list — the only part with documents
// behind it. The rest is derived by buildShoppingList() and stored nowhere.
// ---------------------------------------------------------------------------

describe('manual shopping items', () => {
  const itemPath = (uid, id = 'shopping-1') => `users/${uid}/shoppingItems/${id}`;

  it('accepts the document useShoppingList writes', async () => {
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER)).set(validShoppingItem()));
  });

  it('requires the documented fields', async () => {
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set({ name: 'Batteries' }));
  });

  it('lets an owner read their own list', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validShoppingItem()));
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER)).get());
  });

  it("keeps one cook out of another cook's list", async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validShoppingItem()));

    await assertFails(as(INTRUDER).doc(itemPath(OWNER)).get());
    await assertFails(as(INTRUDER).doc(itemPath(OWNER, 'intruded')).set(validShoppingItem()));
    await assertFails(as(INTRUDER).doc(itemPath(OWNER)).delete());
  });

  it('stops a signed-out visitor touching a list at all', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validShoppingItem()));

    await assertFails(anon().doc(itemPath(OWNER)).get());
    await assertFails(anon().doc(itemPath(OWNER, 'anon')).set(validShoppingItem()));
  });

  it('rejects a nameless row — it would be unreadable and unnameable', async () => {
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validShoppingItem({ name: '' }))
    );
    // A row named "   " renders exactly as blank as one named "". The hook
    // trims before writing; the rule trims before measuring, so the two do not
    // have to trust each other.
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validShoppingItem({ name: '   ' }))
    );
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validShoppingItem({ name: 42 }))
    );
  });

  it.each(['pending', 'bought'])('accepts status "%s"', async (status) => {
    await assertSucceeds(
      as(OWNER)
        .doc(itemPath(OWNER, `shopping-${status}`))
        .set(validShoppingItem({ status }))
    );
  });

  it('rejects an unrecognised status', async () => {
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validShoppingItem({ status: 'maybe' }))
    );
  });

  it('rejects any source but manual — nothing else writes this collection', async () => {
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validShoppingItem({ source: 'ai' }))
    );
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validShoppingItem({ source: 'derived' }))
    );
  });

  it('requires a positive quantity', async () => {
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validShoppingItem({ quantity: 0 }))
    );
    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .set(validShoppingItem({ quantity: -1 }))
    );
  });

  it('ticks an item off with exactly the patch setBought sends', async () => {
    const item = validShoppingItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    // The hook sends these two fields and nothing else. `request.resource` is
    // the *resulting* document, so the required-field check still passes —
    // which is the whole reason a partial update is safe here.
    await assertSucceeds(
      as(OWNER).doc(itemPath(OWNER)).update({ status: 'bought', boughtAt: new Date().toISOString() })
    );
  });

  it('puts an item back on the list with the patch that untick sends', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validShoppingItem({ status: 'bought' })));

    await assertSucceeds(
      as(OWNER).doc(itemPath(OWNER)).update({ status: 'pending', boughtAt: null })
    );
  });

  it('refuses to let ticking off restamp when the cook wrote the item down', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validShoppingItem()));

    await assertFails(
      as(OWNER)
        .doc(itemPath(OWNER))
        .update({ status: 'bought', createdAt: new Date(2099, 0, 1).toISOString() })
    );
  });

  it('re-applies every create-time check on update', async () => {
    const item = validShoppingItem();
    await seed((db) => db.doc(itemPath(OWNER)).set(item));

    // Each of these is a constraint that would be one edit away from being
    // bypassed if update only checked ownership.
    await assertFails(as(OWNER).doc(itemPath(OWNER)).update({ name: '' }));
    await assertFails(as(OWNER).doc(itemPath(OWNER)).update({ status: 'maybe' }));
    await assertFails(as(OWNER).doc(itemPath(OWNER)).update({ source: 'ai' }));
    await assertFails(as(OWNER).doc(itemPath(OWNER)).update({ quantity: 0 }));
  });

  it('refuses an update that drops a required field', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validShoppingItem()));

    // `set` without merge replaces the document, so this is the update path
    // that can leave a row the list renders blank.
    const { normalized, ...withoutNormalized } = validShoppingItem();
    await assertFails(as(OWNER).doc(itemPath(OWNER)).set(withoutNormalized));
  });

  it('lets an owner clear an item off the list for good', async () => {
    await seed((db) => db.doc(itemPath(OWNER)).set(validShoppingItem({ status: 'bought' })));
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER)).delete());
  });

  it('keeps an item that is not week-bound — no weekId to validate', async () => {
    // A manual item outlives the week it was added in, so nothing in the rules
    // ties it to one. Written here so that stays a decision rather than an
    // oversight: if a weekId is ever added, this test has to change with it.
    const stored = validShoppingItem();
    await assertSucceeds(as(OWNER).doc(itemPath(OWNER, 'no-week')).set(stored));
    expect(Object.keys(stored)).not.toContain('weekId');
  });
});

describe('syncMetadata', () => {
  it('is readable by signed-in users so the sync dashboard can show status', async () => {
    await seed((db) => db.doc('syncMetadata/recipesSync').set({ syncStatus: 'pending' }));
    await assertSucceeds(as(OWNER).doc('syncMetadata/recipesSync').get());
  });

  it('is never writable from the client — only Cloud Functions may update it', async () => {
    await assertFails(as(OWNER).doc('syncMetadata/recipesSync').set({ syncStatus: 'complete' }));
  });

  // `syncMetadata` is a root collection. `onUserCreate` also writes a
  // per-user `users/{uid}/syncMetadata/recipesSync` through the admin SDK,
  // which bypasses rules — and no rule matches that path, so `{document=**}`
  // denies it to everyone including its owner.
  //
  // Nothing reads it: the dashboard (src/hooks/useSyncStatus.js) and the sync
  // function both use the root document. This pins that the per-user copy is
  // unreachable rather than quietly readable, so if anything ever starts
  // reading it, this test is where the missing rule gets noticed.
  it('does not expose the per-user copy onUserCreate writes', async () => {
    await seed((db) =>
      db.doc(`users/${OWNER}/syncMetadata/recipesSync`).set({ syncStatus: 'pending' })
    );

    await assertFails(as(OWNER).doc(`users/${OWNER}/syncMetadata/recipesSync`).get());
    await assertFails(as(INTRUDER).doc(`users/${OWNER}/syncMetadata/recipesSync`).get());
    await assertFails(
      as(OWNER).doc(`users/${OWNER}/syncMetadata/recipesSync`).set({ syncStatus: 'complete' })
    );
  });

  it('lets the dashboard read the legacy sync progress document', async () => {
    await seed((db) =>
      db.doc('syncMetadata/legacy-recipe-sync').set({
        currentStatus: 'in-progress',
        recipesToProcess: 500,
        recipesProcessed: 40,
        instructionSources: { spoonacular: 25, ai_generated: 10 },
        costAccumulated: 1.25,
        costLimitUsd: 10,
        cursor: 'users/legacy-user/recipes/abc',
      })
    );

    await assertSucceeds(as(OWNER).doc('syncMetadata/legacy-recipe-sync').get());
  });

  // The dashboard's Run button goes through a Cloud Function precisely because
  // the client cannot write the cost total it would otherwise be trusted with.
  it('stops the dashboard rewriting the cost total from the client', async () => {
    await seed((db) => db.doc('syncMetadata/legacy-recipe-sync').set({ costAccumulated: 8.5 }));

    await assertFails(
      as(OWNER).doc('syncMetadata/legacy-recipe-sync').update({ costAccumulated: 0 })
    );
  });

  it('hides sync status from signed-out visitors', async () => {
    await seed((db) => db.doc('syncMetadata/legacy-recipe-sync').set({ currentStatus: 'idle' }));
    await assertFails(anon().doc('syncMetadata/legacy-recipe-sync').get());
  });
});

describe('default deny', () => {
  it('blocks reads and writes to collections the rules do not mention', async () => {
    await assertFails(as(OWNER).doc('somethingElse/doc-1').set({ anything: true }));
    await assertFails(as(OWNER).doc('somethingElse/doc-1').get());
  });
});
