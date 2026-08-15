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
const { ingredientShelfLife } = require('../data/ingredientShelfLife');

/** Firestore's hard limit on writes in a single batch. */
const BATCH_SIZE = 500;

/** How many row errors get stored on the history record. */
const MAX_LOGGED_ERRORS = 20;

/**
 * Used when the ingredient table cannot help. These are the same numbers as
 * `SHELF_LIFE_DEFAULTS` in src/hooks/useInventory.js, which is what an item
 * added by hand gets — an imported item should not expire on a different date
 * than the same item typed in.
 */
const SHELF_LIFE_FALLBACK = { fridge: 7, freezer: 180, pantry: 90 };

/** Last resort, when even the kind of storage is unrecognised. */
const FALLBACK_DAYS = 30;

/**
 * Raw table lookup, keeping "never heard of it" (undefined) apart from "knows
 * it, and says not there" (null) — the mirror of `lookupShelfLife` in
 * src/hooks/useIngredientMetadata.js.
 *
 * `getShelfLife` from the data module cannot be used here: it collapses an
 * unknown ingredient into defaults of its own (freezer 90, pantry 30) that
 * differ from the ones above, so an unknown item imported by this function got
 * a different expiry than the same row imported in the browser.
 */
const lookupShelfLife = (name, locationType) => {
  const entry =
    ingredientShelfLife[
      String(name || '')
        .toLowerCase()
        .trim()
    ];
  return entry ? entry[locationType] : undefined;
};

/** Split rows into batch-sized chunks. */
const chunk = (rows, size = BATCH_SIZE) => {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
};

/** Whole calendar days from today until `date`, floored at one. */
const daysUntil = (date) => {
  const midnight = (value) => {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  return Math.max(1, Math.round((midnight(date) - midnight(new Date())) / 86400000));
};

/**
 * How long a row's food keeps, and who decided that.
 *
 * A shelf life or an expiry date in the file was chosen by whoever wrote the
 * file, so it is `custom` and the app must not silently recalculate it on the
 * next edit. Anything else is ours: the ingredient table first, then the
 * default for that kind of storage.
 *
 * Kept in step with `resolveRowShelfLife` in src/hooks/useCSVImport.js — the
 * two importers write the same documents and a cook cannot tell which one ran.
 */
const resolveRowShelfLife = (data) => {
  // `> 0` rather than truthiness: a row saying "0 days" is still the file
  // speaking, and it must not fall through to our own guess.
  if (Number(data.shelfLifeDays) > 0) {
    return { days: Number(data.shelfLifeDays), source: 'custom' };
  }

  if (data.expiresAt) {
    return { days: daysUntil(data.expiresAt), source: 'custom' };
  }

  const known = lookupShelfLife(data.name, data.locationType);
  return {
    days:
      typeof known === 'number' ? known : SHELF_LIFE_FALLBACK[data.locationType] || FALLBACK_DAYS,
    source: 'default',
  };
};

/**
 * Build the inventory document for a validated row.
 *
 * `source: 'csv-import'` is what firestore.rules checks on create — an item
 * tagged with anything else (`addedBy`, say) is rejected.
 */
const buildInventoryDoc = (data, timestamp) => {
  const { days: shelfLifeDays, source: shelfLifeSource } = resolveRowShelfLife(data);

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
    shelfLifeSource,
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
  const snapshot = await db.collection('users').doc(userId).collection('storageLocations').get();

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
      batchRows.forEach((row) =>
        batch.set(inventoryRef.doc(), buildInventoryDoc(row.data, timestamp))
      );
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

    res
      .status(result.status === 'error' ? 400 : 200)
      .json(Object.assign({ timestamp: new Date().toISOString() }, result));
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
  resolveRowShelfLife,
  chunk,
  BATCH_SIZE,
  MAX_LOGGED_ERRORS,
};
