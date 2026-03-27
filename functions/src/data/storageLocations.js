// functions/src/storageLocations.js
// Cloud Functions for storage location management
// Callable functions: createStorageLocation, updateStorageLocation, deleteStorageLocation

const functions = require('firebase-functions');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { isValidLocationType } = require('./defaultLocations');

// ---------------------------------------------------------------------------
// Icon & Color defaults per type
// ---------------------------------------------------------------------------
const TYPE_DEFAULTS = {
  fridge:  { icon: '🧊', color: '#3498db' },
  freezer: { icon: '❄️',  color: '#9b59b6' },
  pantry:  { icon: '🏺', color: '#e67e22' },
};

// ---------------------------------------------------------------------------
// createStorageLocation
// ---------------------------------------------------------------------------
exports.createStorageLocation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { label, type, icon, color } = data;
  const userId = context.auth.uid;

  // Validation
  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'label is required.');
  }
  if (!isValidLocationType(type)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `type must be one of: fridge, freezer, pantry. Got: "${type}"`
    );
  }

  const db = getFirestore();
  const locationsRef = db.collection('users').doc(userId).collection('storageLocations');

  // Determine next order value
  const existingSnap = await locationsRef.orderBy('order', 'desc').limit(1).get();
  const maxOrder = existingSnap.empty ? 0 : (existingSnap.docs[0].data().order ?? 0);

  const defaults = TYPE_DEFAULTS[type];
  const locationData = {
    label: label.trim(),
    type,
    icon:  icon  || defaults.icon,
    color: color || defaults.color,
    order: maxOrder + 1,
    isDefault: false,
    itemCount: 0,
    createdAt: FieldValue.serverTimestamp(),
  };

  const docRef = await locationsRef.add(locationData);

  return { success: true, locationId: docRef.id, location: { id: docRef.id, ...locationData } };
});

// ---------------------------------------------------------------------------
// updateStorageLocation
// ---------------------------------------------------------------------------
exports.updateStorageLocation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { locationId, label, icon, color } = data;
  const userId = context.auth.uid;

  if (!locationId) {
    throw new functions.https.HttpsError('invalid-argument', 'locationId is required.');
  }

  const db = getFirestore();
  const locationRef = db
    .collection('users')
    .doc(userId)
    .collection('storageLocations')
    .doc(locationId);

  const snap = await locationRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Location not found.');
  }

  // Build update payload — only include fields that were provided
  const updates = { updatedAt: FieldValue.serverTimestamp() };
  if (label !== undefined) updates.label = label.trim();
  if (icon  !== undefined) updates.icon  = icon;
  if (color !== undefined) updates.color = color;
  // Note: type and isDefault are intentionally not updatable here

  await locationRef.update(updates);

  return { success: true, locationId };
});

// ---------------------------------------------------------------------------
// deleteStorageLocation
// ---------------------------------------------------------------------------
exports.deleteStorageLocation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { locationId } = data;
  const userId = context.auth.uid;

  if (!locationId) {
    throw new functions.https.HttpsError('invalid-argument', 'locationId is required.');
  }

  const db = getFirestore();
  const locationRef = db
    .collection('users')
    .doc(userId)
    .collection('storageLocations')
    .doc(locationId);

  const snap = await locationRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Location not found.');
  }

  const locationData = snap.data();

  // Safety: cannot delete default locations
  if (locationData.isDefault) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Cannot delete a default location.'
    );
  }

  // Safety: cannot delete a location that still has items
  const inventoryRef = db.collection('users').doc(userId).collection('inventory');
  const itemsSnap = await inventoryRef
    .where('storageLocationId', '==', locationId)
    .limit(1)
    .get();

  if (!itemsSnap.empty) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This location still has items. Move or delete them before removing the location.'
    );
  }

  await locationRef.delete();

  return { success: true, locationId };
});
