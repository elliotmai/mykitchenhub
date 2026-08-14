// e2e/firestore-admin.js
// Reads the emulator's Firestore directly from the test process.
//
// Used to confirm that a write the UI made actually landed in the database.
// The UI renders its own writes optimistically, so "the item is on screen" does
// not prove it was accepted — a write that violates a security rule looks
// identical until you read it back from somewhere else.
//
// Reading back through a second browser page would be more end-to-end, but a
// service-worker-controlled navigation issued while a Firestore connection is
// settling never resolves for Playwright, so it hangs rather than fails.

const admin = require('firebase-admin');
const { TEST_USER } = require('./global-setup');

const PROJECT_ID = process.env.E2E_PROJECT_ID || 'mykitchenhub-e2e';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

let cachedUid = null;

/** UID of the seeded end-to-end account. */
const testUserId = async () => {
  if (!cachedUid) {
    cachedUid = (await admin.auth().getUserByEmail(TEST_USER.email)).uid;
  }
  return cachedUid;
};

/** Every inventory document belonging to the seeded account. */
const inventoryItems = async () => {
  const uid = await testUserId();
  const snap = await admin.firestore().collection(`users/${uid}/inventory`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/** Does an item with this exact name exist in Firestore? */
const inventoryHasItem = async (name) => {
  const items = await inventoryItems();
  return items.some((item) => item.name === name);
};

/** The stored document for an item, or undefined. */
const inventoryItem = async (name) => {
  const items = await inventoryItems();
  return items.find((item) => item.name === name);
};

/** Items whose name starts with `prefix` — bulk imports are named that way. */
const inventoryItemsNamed = async (prefix) => {
  const items = await inventoryItems();
  return items.filter((item) => String(item.name || '').startsWith(prefix));
};

/** Every bulk-import record belonging to the seeded account. */
const importHistoryRecords = async () => {
  const uid = await testUserId();
  const snap = await admin.firestore().collection(`users/${uid}/importHistory`).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

module.exports = {
  testUserId,
  inventoryItems,
  inventoryHasItem,
  inventoryItem,
  inventoryItemsNamed,
  importHistoryRecords,
};
