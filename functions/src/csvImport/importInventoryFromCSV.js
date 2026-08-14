// functions/src/csvImport/importInventoryFromCSV.js
// Bulk inventory import from CSV — roadmap step 3.3.
//
// The in-app importer (src/components/CSVImport) writes its rows straight from
// the browser so it can show live progress; this is the same import for
// server-side and API callers — scripts, integrations, and files too large to
// want a browser tab open for. Both write the identical document shape.
//
// Writes go out in batches of 500, Firestore's per-batch limit, and every run
// appends a record to users/{uid}/importHistory.

const admin = require('firebase-admin');
const functions = require('firebase-functions');

const { validateCSV } = require('./csvValidation');
const { getShelfLife } = require('../data/ingredientShelfLife');

/** Firestore's hard limit on writes in a single batch. */
const BATCH_SIZE = 500;

/** How many row errors get stored on the history record. */
const MAX_LOGGED_ERRORS = 20;

const SHELF_LIFE_FALLBACK = { fridge: 7, freezer: 180, pantry: 90 };

/** Split rows into batch-sized chunks. */
const chunk = (rows, size = BATCH_SIZE) => {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
};

/**
 * Days of shelf life for a row: whatever the file said, else what the
 * ingredient table knows, else the default for that kind of storage.
 */
const resolveShelfLifeDays = (data) => {
  if (data.shelfLifeDays) return data.shelfLifeDays;

  if (data.expiresAt) {
    const days = Math.ceil((data.expiresAt - new Date()) / (1000 * 60 * 60 * 24));
    return Math.max(1, days);
  }

  const known = getShelfLife(data.name, data.locationType);
  return known || SHELF_LIFE_FALLBACK[data.locationType] || 30;
};

/**
 * Build the inventory document for a validated row.
 *
 * `source: 'csv-import'` is what firestore.rules checks on create — an item
 * tagged with anything else (`addedBy`, say) is rejected.
 */
const buildInventoryDoc = (data, timestamp) => {
  const shelfLifeDays = resolveShelfLifeDays(data);

  let expiresAt = data.expiresAt;
  if (!expiresAt) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + shelfLifeDays);
  }

  return {
    name: data.name,
    normalized: data.normalized,
    quantity: data.quantity,
    unit: data.unit || '',
    locationId: data.locationId,
    locationType: data.locationType,
    addedAt: timestamp,
    expiresAt,
    shelfLifeDays,
    notes: data.notes || '',
    source: 'csv-import',
    purchaseHistory: [
      {
        addedAt: new Date(),
        quantity: data.quantity,
        unit: data.unit || '',
        price: data.price === undefined ? null : data.price,
        store: data.store || '',
      },
    ],
    totalTimesPurchased: 1,
  };
};

/** The user's storage locations, which CSV rows are matched against. */
const loadLocations = async (db, userId) => {
  const snapshot = await db
    .collection('users')
    .doc(userId)
    .collection('storageLocations')
    .get();

  return snapshot.docs.map((doc) => Object.assign({ id: doc.id }, doc.data()));
};

/**
 * Import a CSV payload into one user's inventory.
 *
 * Resolves to a summary rather than throwing on bad data: a file with 3 broken
 * rows out of 100 imports the other 97 and reports what it skipped.
 *
 * @returns {Promise<{status: string, itemsImported: number, itemsSkipped: number,
 *                    errors: Array, importId: (string|null), message: (string|undefined)}>}
 */
const importCSVForUser = async ({ db, userId, csvData, fileName = 'import.csv' }) => {
  const locations = await loadLocations(db, userId);
  const analysis = validateCSV(csvData, locations);

  if (analysis.fileError) {
    return {
      status: 'error',
      message: analysis.fileError,
      itemsImported: 0,
      itemsSkipped: 0,
      errors: [],
      importId: null,
    };
  }

  const loggedErrors = analysis.errorRows.slice(0, MAX_LOGGED_ERRORS).map((row) => ({
    row: row.row,
    message: row.errors.join(' '),
  }));

  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const inventoryRef = db.collection('users').doc(userId).collection('inventory');

  let imported = 0;
  let failure = null;

  try {
    const batches = chunk(analysis.validRows, BATCH_SIZE);

    for (const batchRows of batches) {
      const batch = db.batch();
      batchRows.forEach((row) => batch.set(inventoryRef.doc(), buildInventoryDoc(row.data, timestamp)));
      // eslint-disable-next-line no-await-in-loop -- batches must land in order
      await batch.commit();
      imported += batchRows.length;
    }
  } catch (error) {
    console.error('CSV import failed part-way:', error);
    failure = error;
  }

  const skipped = analysis.errorRows.length + (analysis.validRows.length - imported);
  const status = failure ? (imported > 0 ? 'partial' : 'failed') : 'completed';

  const historyRecord = {
    fileName,
    importedAt: timestamp,
    itemsImported: imported,
    itemsSkipped: skipped,
    status,
    source: 'csv-import',
    errorCount: analysis.errorRows.length + (failure ? 1 : 0),
    errors: failure
      ? loggedErrors.concat([{ row: 0, message: failure.message }]).slice(0, MAX_LOGGED_ERRORS)
      : loggedErrors,
  };

  let importId = null;
  try {
    const historyRef = db.collection('users').doc(userId).collection('importHistory').doc();
    await historyRef.set(historyRecord);
    importId = historyRef.id;
  } catch (error) {
    // A missing log entry must not turn a successful import into a failure.
    console.error('Could not write import history:', error);
  }

  return {
    status,
    itemsImported: imported,
    itemsSkipped: skipped,
    errors: historyRecord.errors,
    importId,
    message: failure ? failure.message : undefined,
  };
};

/**
 * Resolve who this import is for.
 *
 * A bearer ID token wins over the body — a caller that presents one may only
 * import into their own kitchen. Without a token we fall back to the body's
 * userId, matching the other HTTP functions in this project.
 */
const resolveUserId = async (req) => {
  const header = (req.get ? req.get('Authorization') : null) || (req.headers || {}).authorization;

  if (header && header.startsWith('Bearer ')) {
    const decoded = await admin.auth().verifyIdToken(header.slice('Bearer '.length));
    return decoded.uid;
  }

  return (req.body || {}).userId;
};

/**
 * HTTP handler.
 *
 * Request body: { userId, csvData, fileName }
 * Optional header: Authorization: Bearer <Firebase ID token>
 */
const handler = async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST to import a CSV file' });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (error) {
    console.error('Rejected CSV import with an invalid ID token');
    res.status(401).json({ error: 'Invalid authentication token' });
    return;
  }

  const { csvData, fileName } = req.body || {};

  if (!userId || !csvData) {
    res.status(400).json({ error: 'Missing required fields: userId, csvData' });
    return;
  }

  try {
    const result = await importCSVForUser({
      db: admin.firestore(),
      userId,
      csvData,
      fileName: fileName || 'import.csv',
    });

    res.status(result.status === 'error' ? 400 : 200).json(
      Object.assign({ timestamp: new Date().toISOString() }, result)
    );
  } catch (error) {
    console.error('Error in importInventoryFromCSV:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

const importInventoryFromCSV = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onRequest(handler);

module.exports = {
  importInventoryFromCSV,
  handler,
  importCSVForUser,
  buildInventoryDoc,
  resolveShelfLifeDays,
  chunk,
  BATCH_SIZE,
  MAX_LOGGED_ERRORS,
};
