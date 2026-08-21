// functions/src/alexa/shoppingList.js
// The shopping list, as the Alexa skill sees it.
//
// Two things live under one name here, and the skill has to know about both:
//
//   users/{uid}/shoppingListItems   rows somebody added — by hand or by voice
//   users/{uid}/mealPlans/{week}    the list this week's meals imply
//
// Only the first is writable: the second is derived from the meal plan and the
// kitchen (see src/hooks/useShoppingList.js for the same merge on the client).
// So "what's on my list?" reads both, and "add milk" writes the first.
//
// Everything here goes through the admin SDK, which bypasses the security
// rules — so this module enforces the same shape those rules do. A row written
// from a speaker must be a row the app could have written itself.

const { getFirestore } = require('firebase-admin/firestore');
const { toDayKey, startOfWeek } = require('../mealPlan/planContext');

const ITEMS_COLLECTION = 'shoppingListItems';

/** How many rows the skill will read out before it stops and says "and more". */
const SPOKEN_LIMIT = 10;

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/** Matches the client's key: an ingredient *and* the unit it is counted in. */
const shoppingKey = (name, unit) => `${normalize(name)}|${normalize(unit)}`;

function itemsRef(db, uid) {
  return db.collection('users').doc(uid).collection(ITEMS_COLLECTION);
}

/**
 * Everything still to buy, from both sources, most recent first.
 *
 * @returns {Promise<array>} rows of { name, quantity, unit, source, id?, fromPlan }
 */
async function readList({ uid, db, now = new Date(), limit = SPOKEN_LIMIT } = {}) {
  const firestore = db || getFirestore();

  const storedSnap = await itemsRef(firestore, uid).where('status', '==', 'pending').get();

  const stored = storedSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      quantity: data.quantity,
      unit: data.unit || '',
      source: data.source || 'manual',
      fromPlan: false,
    };
  });

  const seen = new Set(stored.map((item) => shoppingKey(item.name, item.unit)));

  // The week's own list, if a plan has been generated for it. A missing plan is
  // the normal case for a household that has not opened the meal planner —
  // not an error, just nothing to add.
  const weekStart = toDayKey(startOfWeek(now));
  const planSnap = await firestore
    .collection('users')
    .doc(uid)
    .collection('mealPlans')
    .doc(weekStart)
    .get();

  const derived = [];
  if (planSnap.exists) {
    (planSnap.data().shoppingList || []).forEach((item) => {
      if (item.haveInInventory) return;
      const key = shoppingKey(item.normalized || item.name, item.unit);
      if (seen.has(key)) return;
      seen.add(key);
      derived.push({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit || '',
        source: 'meal-plan',
        fromPlan: true,
      });
    });
  }

  const all = [...stored, ...derived];
  return {
    items: all.slice(0, limit),
    total: all.length,
  };
}

/**
 * Put something on the list.
 *
 * Saying "add milk" twice should not produce two rows of milk — the cook is
 * reminding the list, not ordering a second one. An existing pending row wins
 * and the skill says so.
 *
 * @returns {Promise<{added: boolean, duplicate?: boolean, item: object}>}
 */
async function addItem({ uid, name, quantity, unit = '', db, now = new Date() } = {}) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Nothing to add.');

  const firestore = db || getFirestore();

  // The security rules reject quantity <= 0, and an unqualified "add milk"
  // carries no number: one of a thing is what somebody means when they do not
  // say how many.
  const amount = Number(quantity);
  const safeQuantity = Number.isFinite(amount) && amount > 0 ? amount : 1;
  const safeUnit = String(unit ?? '').trim();

  const existing = await itemsRef(firestore, uid)
    .where('normalized', '==', normalize(trimmed))
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    return { added: false, duplicate: true, item: { id: doc.id, ...doc.data() } };
  }

  const item = {
    name: trimmed,
    normalized: normalize(trimmed),
    quantity: safeQuantity,
    unit: safeUnit,
    status: 'pending',
    source: 'alexa',
    addedAt: now,
    boughtAt: null,
  };

  const ref = await itemsRef(firestore, uid).add(item);
  return { added: true, item: { id: ref.id, ...item } };
}

/**
 * Take something off the list.
 *
 * Only rows this collection owns can be deleted. An item that is only on the
 * list because a meal needs it has no document to remove — the honest answer
 * there is that it came from the meal plan, which is what the caller tells the
 * cook rather than pretending to have removed it.
 *
 * @returns {Promise<{removed: boolean, fromPlan?: boolean, name: string}>}
 */
async function removeItem({ uid, name, db, now = new Date() } = {}) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Nothing to remove.');

  const firestore = db || getFirestore();

  const matches = await itemsRef(firestore, uid)
    .where('normalized', '==', normalize(trimmed))
    .where('status', '==', 'pending')
    .get();

  if (!matches.empty) {
    // Read the name off the document *before* deleting it: a snapshot is a
    // copy in production, but nothing about this code should depend on that.
    const spokenName = matches.docs[0].data().name || trimmed;
    const count = matches.size;

    const batch = firestore.batch();
    matches.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    return { removed: true, name: spokenName, count };
  }

  // Not stored — but it may still be one of the week's rows, and "it isn't on
  // your list" would be wrong if the cook can plainly see that it is.
  const { items } = await readList({ uid, db: firestore, now, limit: Infinity });
  const planned = items.find((item) => normalize(item.name) === normalize(trimmed));

  if (planned) return { removed: false, fromPlan: true, name: planned.name };

  return { removed: false, name: trimmed };
}

module.exports = {
  ITEMS_COLLECTION,
  SPOKEN_LIMIT,
  normalize,
  shoppingKey,
  readList,
  addItem,
  removeItem,
};
