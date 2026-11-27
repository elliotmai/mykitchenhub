// e2e/global-setup.js
// Seeds the local Supabase stack (e2e/supabase/, started by
// `npm run e2e:db:start`) with the accounts the suite signs in as, each with a
// stocked kitchen so the specs can immediately exercise real data.
//
// One account per worker plus one for the auth spec — see e2e/accounts.js for
// why. Seeding them all here rather than lazily in a fixture keeps the cost off
// the clock of whichever spec happened to run first, and means a spec that
// reads the kitchen never races the code that filled it.
//
// Every run starts clean: any account left by an earlier run on the same stack
// is deleted first, with its household and everything in it, then made again.

const { TEST_USER, EMPTY_USER, accountForWorker } = require('./accounts');
const {
  SUPABASE_URL,
  Timestamp,
  usersByEmail,
  createAccount,
  deleteAccount,
  putDoc,
} = require('./supabase-admin');

/** Every e2e account is an @example.com address starting with e2e-. */
const isE2EAccount = (email) => /^e2e-.*@example\.com$/i.test(String(email || ''));

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

/** Storage locations — the app reads `label`, not `name`. */
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
 * Gives one account a household, a profile, three storage locations and three
 * items.
 *
 * Every account gets the identical kitchen, so a spec's expectations hold
 * whichever worker picks it up.
 */
const seedKitchen = async (account, { withItems = true } = {}) => {
  const { uid, hid } = await createAccount(account);
  const me = `users/${uid}`;

  await putDoc(hid, me, {
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
      putDoc(hid, `${me}/storageLocations/${id}`, {
        ...data,
        isDefault: true,
        itemCount: 0,
        createdAt: new Date().toISOString(),
      })
    )
  );

  // The empty-state account stops here: a profile and the default shelves are
  // exactly what signing up gives you, and nothing has been put on them yet.
  if (!withItems) return { uid, hid };

  await Promise.all(
    ITEMS.map(({ id, name, expiresIn, locationId, locationType }) =>
      putDoc(hid, `${me}/inventory/${id}`, {
        name,
        normalized: name.toLowerCase(),
        quantity: 1,
        unit: 'ea',
        locationId,
        locationType,
        addedAt: Timestamp.fromDate(daysFromNow(-1)),
        expiresAt: Timestamp.fromDate(daysFromNow(expiresIn)),
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

  // Recipes belong to the household (recipes/<id> in kitchen.docs), so each
  // kitchen gets its own copy of the two seeded ones.
  await Promise.all(
    RECIPES.map(({ id, ...data }) =>
      putDoc(hid, `recipes/${id}`, {
        ...data,
        imageUrl: null,
        timesCooked: 0,
        createdAt: Timestamp.fromDate(daysFromNow(-10)),
      })
    )
  );

  return { uid, hid };
};

// The two recipes every stocked kitchen starts with. Field names are the ones
// the app reads: `name` (not `title`) and a documented `source`.
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

/** Fails fast, and says what to do, when the local stack is not running. */
const checkStack = async () => {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
    if (res.ok) return;
  } catch {
    /* falls through */
  }
  throw new Error(
    `[e2e] No Supabase at ${SUPABASE_URL}. Start the local stack first: npm run e2e:db:start`
  );
};

module.exports = async (config) => {
  await checkStack();

  // Clean up after any earlier run on this stack: its accounts, their
  // households, and everything in those (ON DELETE CASCADE).
  const leftovers = [...(await usersByEmail()).values()].filter((u) => isE2EAccount(u.email));
  for (const user of leftovers) await deleteAccount(user.id);

  // `config.workers` is the resolved worker count, so this seeds exactly as
  // many accounts as there are workers to use them — no guessing, and no
  // account left unseeded when CI runs with a different number than local.
  const workerCount = config?.workers ?? 1;
  const accounts = [
    TEST_USER,
    ...Array.from({ length: workerCount }, (_, i) => accountForWorker(i)),
  ];

  for (const account of accounts) {
    // Sequentially: a failure here should name the account it happened on
    // rather than one of five.
    await seedKitchen(account);
  }

  // One more with nothing in it, for e2e/empty-states.spec.js.
  await seedKitchen(EMPTY_USER, { withItems: false });

  console.log(
    `[e2e] removed ${leftovers.length} old accounts; seeded ${accounts.length} accounts ` +
      `(${workerCount} workers + auth spec) + 1 empty, each with ${LOCATIONS.length} locations, ` +
      `and the stocked ones with ${ITEMS.length} items and ${RECIPES.length} recipes`
  );
};

// Re-exported so the specs and helpers that already import TEST_USER from here
// keep working; e2e/accounts.js is where it is actually defined.
module.exports.TEST_USER = TEST_USER;
