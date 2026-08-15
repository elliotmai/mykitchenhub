// Covers the write side of CSV bulk import: the document shape the security
// rules demand, batching at Firestore's 500-write limit, progress reporting,
// and the import history record left behind whether the run worked or not.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useCSVImport, {
  BATCH_SIZE,
  MAX_LOGGED_ERRORS,
  HISTORY_LIMIT,
  chunk,
  buildInventoryDoc,
} from '../useCSVImport';
import { SHELF_LIFE_DEFAULTS } from '../useInventory';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeImportRecord, makeUserProfile } from '../../test-utils/factories';

const UID = 'test-uid';
const INVENTORY_PATH = `users/${UID}/inventory`;
const HISTORY_PATH = `users/${UID}/importHistory`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

/** A validated row, the shape validateCSV hands to the hook. */
const validRow = (overrides = {}, rowNumber = 2) => ({
  row: rowNumber,
  valid: true,
  errors: [],
  data: {
    name: 'Milk',
    normalized: 'milk',
    quantity: 1,
    unit: 'gal',
    locationId: 'loc-fridge',
    locationType: 'fridge',
    locationLabel: 'Main Fridge',
    notes: '',
    shelfLifeDays: null,
    expiresAt: null,
    price: null,
    store: '',
    ...overrides,
  },
});

const rows = (count, overrides = {}) =>
  Array.from({ length: count }, (_, i) => validRow({ name: `Item ${i}`, ...overrides }, i + 2));

const renderImport = async ({ signedIn = true } = {}) => {
  authMock.__setUser(signedIn ? authMock.__user({ uid: UID }) : null);
  if (signedIn) fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useCSVImport(), { wrapper });
  await waitFor(() => expect(view.result.current.importItems).toEqual(expect.any(Function)));
  return view;
};

/** Every document handed to a batch across every commit, in write order. */
const batchedDocs = () =>
  fs.writeBatch.mock.results.flatMap(({ value }) =>
    value.set.mock.calls.map(([ref, data]) => ({ path: fs.pathOf(ref), data }))
  );

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('chunk', () => {
  it('splits rows into batches of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('defaults to Firestore’s 500-write batch limit', () => {
    expect(chunk(new Array(1200).fill('x')).map((c) => c.length)).toEqual([500, 500, 200]);
  });

  it('returns nothing for no rows', () => {
    expect(chunk([])).toEqual([]);
  });
});

describe('buildInventoryDoc', () => {
  it('tags every imported item with source csv-import, not addedBy', () => {
    const doc = buildInventoryDoc(validRow().data);

    expect(doc.source).toBe('csv-import');
    expect(doc.addedBy).toBeUndefined();
  });

  it('includes every field the security rules require on create', () => {
    const doc = buildInventoryDoc(validRow().data);

    [
      'name',
      'normalized',
      'quantity',
      'unit',
      'locationId',
      'locationType',
      'addedAt',
      'source',
    ].forEach((field) => expect(doc[field]).toBeDefined());
    expect(doc.quantity).toBeGreaterThan(0);
    expect(doc.addedAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('keeps an expiry date the file supplied', () => {
    const expiresAt = new Date('2027-03-01');
    const doc = buildInventoryDoc(validRow({ expiresAt }).data);

    expect(doc.expiresAt).toBe(expiresAt);
  });

  it('derives shelf life from an explicit expiry date', () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 10);

    expect(buildInventoryDoc(validRow({ expiresAt }).data).shelfLifeDays).toBe(10);
  });

  it('falls back to the shelf-life default for the location type', () => {
    const doc = buildInventoryDoc(validRow({ locationType: 'freezer' }).data);
    const daysOut = Math.round((doc.expiresAt - new Date()) / (1000 * 60 * 60 * 24));

    expect(daysOut).toBe(180);
  });

  it.each(['fridge', 'freezer', 'pantry'])(
    'always records a shelf life, so editing a %s item cannot move its expiry',
    (locationType) => {
      // The edit form recalculates expiresAt from the item's shelfLifeDays. A
      // null one made it fall back to the default, counted from the day of the
      // edit — every edit pushed an imported item's expiry further out.
      const doc = buildInventoryDoc(validRow({ locationType }).data);

      expect(doc.shelfLifeDays).toBe(SHELF_LIFE_DEFAULTS[locationType]);
      expect(Math.round((doc.expiresAt - new Date()) / (1000 * 60 * 60 * 24))).toBe(
        doc.shelfLifeDays
      );
    }
  );

  it('records the purchase, price and store included, so analytics has history', () => {
    const doc = buildInventoryDoc(validRow({ price: 4.99, store: 'Costco' }).data);

    expect(doc.purchaseHistory).toHaveLength(1);
    expect(doc.purchaseHistory[0]).toMatchObject({ quantity: 1, price: 4.99, store: 'Costco' });
    expect(doc.totalTimesPurchased).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// importItems
// ---------------------------------------------------------------------------

describe('importItems', () => {
  it('writes each row into the signed-in user’s inventory', async () => {
    const { result } = await renderImport();

    await act(async () => {
      await result.current.importItems(rows(3), { fileName: 'kitchen.csv' });
    });

    const written = batchedDocs();
    expect(written).toHaveLength(3);
    written.forEach(({ path, data }) => {
      expect(path).toBe(INVENTORY_PATH);
      expect(data.source).toBe('csv-import');
    });
    expect(written.map(({ data }) => data.name)).toEqual(['Item 0', 'Item 1', 'Item 2']);
  });

  it('reports how many items it imported', async () => {
    const { result } = await renderImport();

    let outcome;
    await act(async () => {
      outcome = await result.current.importItems(rows(3), { skipped: 2 });
    });

    expect(outcome).toMatchObject({ success: true, imported: 3, skipped: 2 });
  });

  it('commits a large file 500 at a time', async () => {
    const { result } = await renderImport();

    await act(async () => {
      await result.current.importItems(rows(1200));
    });

    expect(fs.writeBatch).toHaveBeenCalledTimes(3);
    const perBatch = fs.writeBatch.mock.results.map(({ value }) => value.set.mock.calls.length);
    expect(perBatch).toEqual([BATCH_SIZE, BATCH_SIZE, 200]);
    fs.writeBatch.mock.results.forEach(({ value }) =>
      expect(value.commit).toHaveBeenCalledTimes(1)
    );
  });

  it.each([
    [499, [499]],
    [500, [500]],
    [501, [500, 1]],
    [1000, [500, 500]],
  ])('splits %s rows across batches as %j', async (count, expected) => {
    const { result } = await renderImport();

    await act(async () => {
      await result.current.importItems(rows(count));
    });

    expect(fs.writeBatch.mock.results.map(({ value }) => value.set.mock.calls.length)).toEqual(
      expected
    );
    expect(batchedDocs()).toHaveLength(count);
  });

  it('imports a 150-item file in a single batch', async () => {
    const { result } = await renderImport();

    await act(async () => {
      await result.current.importItems(rows(150));
    });

    expect(fs.writeBatch).toHaveBeenCalledTimes(1);
    expect(batchedDocs()).toHaveLength(150);
  });

  it('reports progress as each batch lands', async () => {
    const { result } = await renderImport();

    await act(async () => {
      await result.current.importItems(rows(600));
    });

    expect(result.current.progress).toEqual({ processed: 600, total: 600 });
    expect(result.current.importing).toBe(false);
  });

  it('logs the run in the import history', async () => {
    const { result } = await renderImport();

    await act(async () => {
      await result.current.importItems(rows(2), { fileName: 'kitchen.csv', skipped: 1 });
    });

    const [ref, record] = fs.addDoc.mock.calls.at(-1);
    expect(fs.pathOf(ref)).toBe(HISTORY_PATH);
    expect(record).toMatchObject({
      fileName: 'kitchen.csv',
      itemsImported: 2,
      itemsSkipped: 1,
      status: 'completed',
      source: 'csv-import',
    });
    expect(record.importedAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('stores the first few row problems on the record, and the full count', async () => {
    const { result } = await renderImport();
    const errors = Array.from({ length: MAX_LOGGED_ERRORS + 5 }, (_, i) => ({
      row: i + 2,
      errors: ['Missing quantity.'],
    }));

    await act(async () => {
      await result.current.importItems(rows(1), { skipped: errors.length, errors });
    });

    const record = fs.addDoc.mock.calls.at(-1)[1];
    expect(record.errorCount).toBe(errors.length);
    expect(record.errors).toHaveLength(MAX_LOGGED_ERRORS);
    expect(record.errors[0]).toEqual({ row: 2, message: 'Missing quantity.' });
  });

  it('refuses to import when nobody is signed in', async () => {
    const { result } = await renderImport({ signedIn: false });

    let outcome;
    await act(async () => {
      outcome = await result.current.importItems(rows(2));
    });

    expect(outcome).toEqual({ success: false, error: 'Not authenticated' });
    expect(fs.writeBatch).not.toHaveBeenCalled();
  });

  it('refuses an empty row list', async () => {
    const { result } = await renderImport();

    let outcome;
    await act(async () => {
      outcome = await result.current.importItems([]);
    });

    expect(outcome.success).toBe(false);
    expect(fs.writeBatch).not.toHaveBeenCalled();
  });

  it('reports what it managed to save when a later batch fails', async () => {
    const { result } = await renderImport();

    fs.writeBatch
      .mockReturnValueOnce({ set: jest.fn(), commit: jest.fn(async () => undefined) })
      .mockReturnValueOnce({
        set: jest.fn(),
        commit: jest.fn(async () => {
          throw new Error('deadline exceeded');
        }),
      });

    let outcome;
    await act(async () => {
      outcome = await result.current.importItems(rows(600));
    });

    expect(outcome).toMatchObject({ success: false, imported: 500 });
    expect(outcome.error).toMatch(/Imported 500 of 600 items/);

    const record = fs.addDoc.mock.calls.at(-1)[1];
    expect(record.status).toBe('partial');
    expect(record.itemsSkipped).toBe(100);
  });

  it('records a failed import that saved nothing', async () => {
    const { result } = await renderImport();

    fs.writeBatch.mockReturnValueOnce({
      set: jest.fn(),
      commit: jest.fn(async () => {
        throw new Error('permission denied');
      }),
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.importItems(rows(3));
    });

    expect(outcome).toMatchObject({ success: false, imported: 0, error: 'permission denied' });
    expect(fs.addDoc.mock.calls.at(-1)[1].status).toBe('failed');
  });

  it('still reports success when only the history record fails to write', async () => {
    const { result } = await renderImport();
    fs.addDoc.mockRejectedValueOnce(new Error('history unavailable'));

    let outcome;
    await act(async () => {
      outcome = await result.current.importItems(rows(2));
    });

    expect(outcome).toMatchObject({ success: true, imported: 2, historyId: null });
  });

  it('clears progress on reset', async () => {
    const { result } = await renderImport();

    await act(async () => {
      await result.current.importItems(rows(2));
    });
    act(() => result.current.reset());

    expect(result.current.progress).toEqual({ processed: 0, total: 0 });
  });
});

// ---------------------------------------------------------------------------
// history listener
// ---------------------------------------------------------------------------

describe('import history', () => {
  it('subscribes to the newest imports first', async () => {
    await renderImport();

    await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
    expect(fs.pathOf(fs.onSnapshot.mock.calls[0][0])).toBe(HISTORY_PATH);
    expect(fs.orderBy).toHaveBeenCalledWith('importedAt', 'desc');
    expect(fs.limit).toHaveBeenCalledWith(HISTORY_LIMIT);
  });

  it('exposes past imports to the importer', async () => {
    const { result } = await renderImport();

    await act(async () => {
      fs.__emit(HISTORY_PATH, asDocs([makeImportRecord({ fileName: 'january.csv' })]));
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].fileName).toBe('january.csv');
  });

  it('falls back to an empty log when history cannot be read', async () => {
    const { result } = await renderImport();

    await act(async () => {
      fs.__emitError(HISTORY_PATH, new Error('permission denied'));
    });

    expect(result.current.history).toEqual([]);
  });

  it('stops listening when the importer unmounts', async () => {
    const { unmount } = await renderImport();

    await waitFor(() => expect(fs.__listenerCount(HISTORY_PATH)).toBe(1));
    unmount();

    expect(fs.__listenerCount(HISTORY_PATH)).toBe(0);
  });

  it('holds no history for a signed-out visitor', async () => {
    const { result } = await renderImport({ signedIn: false });

    expect(result.current.history).toEqual([]);
    expect(fs.__listenerCount(HISTORY_PATH)).toBe(0);
  });
});
