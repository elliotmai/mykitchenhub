// e2e/global-setup.js
// Seeds the Firebase emulators with the accounts the suite signs in as, each
// with a stocked kitchen so the specs can immediately exercise real data.
//
// Runs once before the Playwright suite, against emulators already started by
// `firebase emulators:exec` (see the test:e2e script).
//
// One account per worker plus one for the auth spec — see e2e/accounts.js for
// why. Seeding them all here rather than lazily in a fixture keeps the cost off
// the clock of whichever spec happened to run first, and means a spec that
// reads the kitchen never races the code that filled it.

const admin = require('firebase-admin');
const { TEST_USER, accountForWorker } = require('./accounts');

const PROJECT_ID = process.env.E2E_PROJECT_ID || 'mykitchenhub-e2e';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

/** Creates an account through the Auth emulator's REST API. */
const createAuthUser = async (account) => {
  const url = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...account, returnSecureToken: true }),
  });

  const body = await response.json();

  // A re-run against warm emulators hits EMAIL_EXISTS; look the user up instead.
  if (!response.ok) {
    if (body?.error?.message === 'EMAIL_EXISTS') {
      const existing = await admin.auth().getUserByEmail(account.email);
      return existing.uid;
    }
    throw new Error(`Auth emulator signUp failed: ${JSON.stringify(body)}`);
  }

  return body.localId;
};

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

/** Storage locations — field names must match firestore.rules (`label`). */
const LOCATIONS = [
  {
    id: 'loc-fridge',
    label: 'Main Fridge',
    type: 'fridge',
    icon: '🧊',
    color: '#3498db',
    order: 1,
  },
  {
    id: 'loc-freezer',
    label: 'Freezer',
    type: 'freezer',
    icon: '❄️',
    color: '#9b59b6',
    order: 2,
  },
  { id: 'loc-pantry', label: 'Pantry', type: 'pantry', icon: '🏺', color: '#e67e22', order: 3 },
];

/** One item per expiration state, so colour-coding is visible end to end. */
const ITEMS = [
  {
    id: 'item-expired',
    name: 'Old Yogurt',
    expiresIn: -2,
    locationId: 'loc-fridge',
    locationType: 'fridge',
  },
  {
    id: 'item-critical',
    name: 'Fresh Salmon',
    expiresIn: 1,
    locationId: 'loc-fridge',
    locationType: 'fridge',
  },
  {
    id: 'item-safe',
    name: 'Basmati Rice',
    expiresIn: 200,
    locationId: 'loc-pantry',
    locationType: 'pantry',
  },
];

/**
 * Gives one account a profile, three storage locations and three items.
 *
 * Every account gets the identical kitchen, so a spec's expectations hold
 * whichever worker picks it up.
 */
const seedKitchen = async (db, account) => {
  const uid = await createAuthUser(account);
  const userRef = db.collection('users').doc(uid);

  await userRef.set({
    email: account.email,
    displayName: account.displayName,
    createdAt: new Date().toISOString(),
    preferences: {
      smsAlerts: { enabled: false, phoneNumber: '', time: '09:00' },
      notifications: { expiringSoon: true, mealPlanReminders: true, lowInventory: false },
      dietary: { restrictions: [], preferences: [], allergies: [] },
    },
    helloFresh: { linked: false, deliveryDays: [1, 3, 5] },
    stats: { totalRecipes: 0, totalItems: 0, wasteReduction: 0 },
  });

  await Promise.all(
    LOCATIONS.map(({ id, ...data }) =>
      userRef
        .collection('storageLocations')
        .doc(id)
        .set({
          ...data,
          isDefault: true,
          itemCount: 0,
          createdAt: new Date().toISOString(),
        })
    )
  );

  await Promise.all(
    ITEMS.map(({ id, name, expiresIn, locationId, locationType }) =>
      userRef
        .collection('inventory')
        .doc(id)
        .set({
          name,
          normalized: name.toLowerCase(),
          quantity: 1,
          unit: 'ea',
          locationId,
          locationType,
          addedAt: admin.firestore.Timestamp.fromDate(daysFromNow(-1)),
          expiresAt: admin.firestore.Timestamp.fromDate(daysFromNow(expiresIn)),
          shelfLifeDays: 7,
          // Seeded items are ours, not the cook's — same as makeItem in
          // src/test-utils/factories.js. Without it the app has to infer, and
          // the first edit of a seeded item rewrites its expiry.
          shelfLifeSource: 'default',
          notes: '',
          source: 'seed',
          purchaseHistory: [],
          totalTimesPurchased: 1,
        })
    )
  );

  return uid;
};

// Recipes are a single global collection, not a per-user one. Field names must
// match firestore.rules: `name` (not `title`) and a documented `source`.
//
// Seeded once for everyone rather than per account, because that is what the
// schema says they are. It is the one thing worker isolation does not cover:
// a spec that creates a recipe is visible to every other worker, so recipe
// specs still have to use unique names. TESTING.md says so out loud.
const RECIPES = [
  {
    id: 'e2e-recipe-salmon',
    name: 'Seeded Sheet Pan Salmon',
    source: 'user-created',
    tags: ['dinner', 'quick'],
    difficulty: 'easy',
    servings: 2,
    prepTime: 5,
    cookTime: 15,
    ingredients: [
      { name: 'salmon', quantity: 2, unit: 'fillet', normalized: 'salmon' },
      { name: 'capers', quantity: 1, unit: 'tbsp', normalized: 'capers' },
    ],
    instructions: ['Heat the oven to 220C.', 'Roast for 15 minutes.'],
  },
  {
    id: 'e2e-recipe-chili',
    name: 'Seeded Grandma Chili',
    source: 'legacy',
    tags: ['dinner', 'legacy'],
    difficulty: 'medium',
    servings: 6,
    prepTime: 20,
    cookTime: 160,
    ingredients: [{ name: 'ground beef', quantity: 2, unit: 'lb', normalized: 'ground beef' }],
    instructions: ['Brown the beef.', 'Simmer for an hour.'],
  },
];

module.exports = async (config) => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }

  const db = admin.firestore();

  // `config.workers` is the resolved worker count, so this seeds exactly as
  // many accounts as there are workers to use them — no guessing, and no
  // account left unseeded when CI runs with a different number than local.
  const workerCount = config?.workers ?? 1;
  const accounts = [
    TEST_USER,
    ...Array.from({ length: workerCount }, (_, i) => accountForWorker(i)),
  ];

  const uids = [];
  for (const account of accounts) {
    // Sequentially: the Auth emulator serialises signUp anyway, and a failure
    // here should name the account it happened on rather than one of five.
    uids.push(await seedKitchen(db, account));
  }

  await Promise.all(
    RECIPES.map(({ id, ...data }) =>
      db
        .collection('recipes')
        .doc(id)
        .set({
          ...data,
          imageUrl: null,
          timesCooked: 0,
          createdAt: admin.firestore.Timestamp.fromDate(daysFromNow(-10)),
        })
    )
  );

  console.log(
    `[e2e] seeded ${accounts.length} accounts (${workerCount} workers + auth spec), ` +
      `each with ${LOCATIONS.length} locations and ${ITEMS.length} items, ` +
      `plus ${RECIPES.length} shared recipes`
  );
};

// Re-exported so the specs and helpers that already import TEST_USER from here
// keep working; e2e/accounts.js is where it is actually defined.
module.exports.TEST_USER = TEST_USER;
