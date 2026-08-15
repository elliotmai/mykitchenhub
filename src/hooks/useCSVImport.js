// src/hooks/useCSVImport.js
// Writes a validated CSV import into Firestore — roadmap step 3.3.
//
// Firestore caps a batch at 500 writes, so a 1,200-row file becomes three
// commits. Progress is reported after each one, which is what the importer's
// progress bar reads, and every run leaves a record in the import history log
// whether it finished, failed part-way, or failed outright.
//
// The Cloud Function `importInventoryFromCSV` writes the identical document
// shape for server-side and API callers; this hook is the in-app path, so an
// import works without deploying functions and can show live progress.

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  doc,
  addDoc,
  writeBatch,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  limit as limitTo,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import {
  SHELF_LIFE_SOURCES,
  calcExpiresAt,
  getDaysUntilExpiration,
  hasExplicitShelfLife,
  resolveShelfLifeDays,
} from './useInventory';

/** Firestore's hard limit on writes in a single batch. */
export const BATCH_SIZE = 500;

/** How many row errors get stored on the history record. */
export const MAX_LOGGED_ERRORS = 20;

/** How many past imports the importer shows. */
export const HISTORY_LIMIT = 5;

/** Split rows into batch-sized chunks. */
export const chunk = (rows, size = BATCH_SIZE) => {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
};

/**
 * Turn a validated CSV row into the inventory document the rules require.
 *
 * `source: 'csv-import'` is the field the security rules check — an item
 * tagged with anything else (`addedBy`, say) is rejected on create.
 */
/**
 * How long a row's food keeps, and who decided that.
 *
 * A shelf life or an expiry date in the file was chosen by whoever wrote the
 * file, so it is `custom` and nothing may quietly recalculate it later. Only a
 * row that says nothing about timing gets our own number — and that number
 * comes from the per-ingredient table, not a blanket per-location default, so
 * imported chicken keeps for two days rather than the fridge's seven.
 */
export const resolveRowShelfLife = (data) => {
  if (hasExplicitShelfLife(data.shelfLifeDays)) {
    return { days: Number(data.shelfLifeDays), source: SHELF_LIFE_SOURCES.CUSTOM };
  }

  if (data.expiresAt) {
    return {
      days: Math.max(1, getDaysUntilExpiration(data.expiresAt) ?? 1),
      source: SHELF_LIFE_SOURCES.CUSTOM,
    };
  }

  return {
    days: resolveShelfLifeDays(data.name, data.locationType),
    source: SHELF_LIFE_SOURCES.DEFAULT,
  };
};

export const buildInventoryDoc = (data) => {
  // Never null. A manually added item always stores a number, and the edit
  // form recalculates expiresAt from whatever shelf life the item carries — so
  // an imported item with a null one had its expiry date quietly pushed out
  // the first time anybody edited it.
  const { days: shelfLifeDays, source: shelfLifeSource } = resolveRowShelfLife(data);

  return {
    name: data.name,
    normalized: data.normalized ?? data.name.toLowerCase(),
    quantity: Number(data.quantity),
    unit: data.unit || '',
    locationId: data.locationId,
    locationType: data.locationType,
    addedAt: serverTimestamp(),
    expiresAt: data.expiresAt ?? calcExpiresAt(data.locationType, shelfLifeDays),
    shelfLifeDays,
    shelfLifeSource,
    notes: data.notes || '',
    source: 'csv-import',
    purchaseHistory: [
      {
        addedAt: new Date(),
        quantity: Number(data.quantity),
        unit: data.unit || '',
        price: data.price ?? null,
        store: data.store || '',
      },
    ],
    totalTimesPurchased: 1,
  };
};

/**
 * useCSVImport Hook
 *
 * const { importItems, importing, progress, history, reset } = useCSVImport();
 * const result = await importItems(validRows, { fileName, skipped, errors });
 */
const useCSVImport = () => {
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [history, setHistory] = useState([]);

  // ---------------------------------------------------------------------------
  // Past imports, newest first
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user?.uid) {
      setHistory([]);
      return;
    }

    const historyQuery = query(
      collection(db, 'users', user.uid, 'importHistory'),
      orderBy('importedAt', 'desc'),
      limitTo(HISTORY_LIMIT)
    );

    const unsubscribe = onSnapshot(
      historyQuery,
      (snapshot) => setHistory(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error('Error loading import history:', err);
        setHistory([]);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // ---------------------------------------------------------------------------
  // Import history record
  // ---------------------------------------------------------------------------
  const recordImport = useCallback(
    async (record) => {
      try {
        const ref = await addDoc(collection(db, 'users', user.uid, 'importHistory'), {
          ...record,
          importedAt: serverTimestamp(),
          source: 'csv-import',
        });
        return ref?.id ?? null;
      } catch (err) {
        // A missing log entry must never turn a successful import into a failure.
        console.error('Error writing import history:', err);
        return null;
      }
    },
    [user?.uid]
  );

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------
  const importItems = useCallback(
    async (rows = [], { fileName = 'import.csv', skipped = 0, errors = [] } = {}) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!rows.length) return { success: false, error: 'There are no valid rows to import.' };

      setImporting(true);
      setProgress({ processed: 0, total: rows.length });

      const loggedErrors = errors
        .slice(0, MAX_LOGGED_ERRORS)
        .map((e) => ({ row: e.row, message: e.errors.join(' ') }));

      let processed = 0;

      try {
        const inventoryRef = collection(db, 'users', user.uid, 'inventory');

        for (const batchRows of chunk(rows, BATCH_SIZE)) {
          const batch = writeBatch(db);
          batchRows.forEach((row) => batch.set(doc(inventoryRef), buildInventoryDoc(row.data)));
          await batch.commit();

          processed += batchRows.length;
          setProgress({ processed, total: rows.length });
        }

        const historyId = await recordImport({
          fileName,
          itemsImported: processed,
          itemsSkipped: skipped,
          status: 'completed',
          errorCount: errors.length,
          errors: loggedErrors,
        });

        return { success: true, imported: processed, skipped, historyId };
      } catch (err) {
        console.error('Error importing CSV rows:', err);

        const historyId = await recordImport({
          fileName,
          itemsImported: processed,
          itemsSkipped: skipped + (rows.length - processed),
          status: processed > 0 ? 'partial' : 'failed',
          errorCount: errors.length + 1,
          errors: [...loggedErrors, { row: 0, message: err.message }].slice(0, MAX_LOGGED_ERRORS),
        });

        return {
          success: false,
          imported: processed,
          skipped,
          historyId,
          error:
            processed > 0
              ? `Imported ${processed} of ${rows.length} items before failing: ${err.message}`
              : err.message,
        };
      } finally {
        setImporting(false);
      }
    },
    [user?.uid, recordImport]
  );

  const reset = useCallback(() => setProgress({ processed: 0, total: 0 }), []);

  return { importItems, importing, progress, history, reset };
};

export default useCSVImport;
