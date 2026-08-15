// e2e/global-setup.js
// Seeds the Firebase emulators with a known account and a stocked kitchen so
// the specs can sign in and immediately exercise real data.
//
// Runs once before the Playwright suite, against emulators already started by
// `firebase emulators:exec` (see the test:e2e script).

const admin = require('firebase-admin');

const PROJECT_ID = process.env.E2E_PROJECT_ID || 'mykitchenhub-e2e';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const TEST_USER = {
  email: 'e2e-cook@example.com',
  password: 'TestPassword123!',
  displayName: 'E2E Cook',
};

/** Creates the account through the Auth emulator's REST API. */
const createAuthUser = async () => {
  const url = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...TEST_USER, returnSecureToken: true }),
  });

  const body = await response.json();

  // A re-run against warm emulators hits EMAIL_EXISTS; look the user up instead.
  if (!response.ok) {
    if (body?.error?.message === 'EMAIL_EXISTS') {
      const existing = await admin.auth().getUserByEmail(TEST_USER.email);
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

module.exports = async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.GCLOUD_PROJECT = PROJECT_ID;

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }

  const db = admin.firestore();
  const uid = await createAuthUser();
  const userRef = db.collection('users').doc(uid);

  await userRef.set({
    email: TEST_USER.email,
    displayName: TEST_USER.displayName,
    createdAt: new Date().toISOString(),
    preferences: {
      smsAlerts: { enabled: false, phoneNumber: '', time: '09:00' },
      notifications: { expiringSoon: true, mealPlanReminders: true, lowInventory: false },
      dietary: { restrictions: [], preferences: [], allergies: [] },
    },
    helloFresh: { linked: false, deliveryDays: [1, 3, 5] },
    stats: { totalRecipes: 0, totalItems: 0, wasteReduction: 0 },
  });

  // Storage locations — field names must match firestore.rules (`label`).
  const locations = [
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

  await Promise.all(
    locations.map(({ id, ...data }) =>
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

  // One item per expiration state, so colour-coding is visible end to end.
  const items = [
    {
      id: 'item-expired',
      name: 'Old Yogurt',
      expiresAt: daysFromNow(-2),
      locationId: 'loc-fridge',
      locationType: 'fridge',
    },
    {
      id: 'item-critical',
      name: 'Fresh Salmon',
      expiresAt: daysFromNow(1),
      locationId: 'loc-fridge',
      locationType: 'fridge',
    },
    {
      id: 'item-safe',
      name: 'Basmati Rice',
      expiresAt: daysFromNow(200),
      locationId: 'loc-pantry',
      locationType: 'pantry',
    },
  ];

  await Promise.all(
    items.map(({ id, name, expiresAt, locationId, locationType }) =>
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
          expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
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

  // Recipes are a single global collection, not a per-user one. Field names must
  // match firestore.rules: `name` (not `title`) and a documented `source`.
  const recipes = [
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

  await Promise.all(
    recipes.map(({ id, ...data }) =>
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
    `[e2e] seeded ${TEST_USER.email} (${uid}) with ${locations.length} locations, ${items.length} items, ${recipes.length} recipes`
  );
};

module.exports.TEST_USER = TEST_USER;
