const {
  EGGS_ITEM_ID,
  FarmEggsError,
  addDays,
  applyFarmEggs,
  collectedOn,
  contribution,
  dayIn,
  isFarmSupplied,
  newEggsItem,
  parseBatch,
  pickEggsItem,
  pickFridge,
} = require('../farmEggs');

const NOW = new Date('2026-11-25T18:00:00Z');
const TODAY = '2026-11-25';
const clock = { now: NOW, today: TODAY };

const log = (id, quantity, version, extra = {}) => ({
  id,
  type: 'log',
  version: Date.parse(version),
  date: TODAY,
  quantity,
  deleted: false,
  ...extra,
});
const gone = (id, quantity, kind, version, extra = {}) => ({
  id,
  type: 'disposition',
  version: Date.parse(version),
  date: TODAY,
  quantity,
  kind,
  deleted: false,
  ...extra,
});

const fresh = (quantity = 0) => ({
  ...newEggsItem({ location: { id: 'fridge1' }, ...clock }),
  quantity,
});

/** Apply batches in turn, the way successive sends would. */
const run = (data, ...batches) =>
  batches.reduce((item, batch) => applyFarmEggs(item, batch, clock).data, data);

describe('contribution', () => {
  it('adds a log, takes away given and sold, ignores kept and deleted', () => {
    expect(contribution(log('a', 6, TODAY))).toBe(6);
    expect(contribution(gone('b', 4, 'given', TODAY))).toBe(-4);
    expect(contribution(gone('c', 12, 'sold', TODAY))).toBe(-12);
    expect(contribution(gone('d', 3, 'kept', TODAY))).toBe(0);
    expect(contribution(log('e', 6, TODAY, { deleted: true }))).toBe(0);
  });
});

describe('applyFarmEggs', () => {
  it('a new log raises the stock by its total', () => {
    const { data, delta, applied } = applyFarmEggs(
      fresh(2),
      [log('a', 6, '2026-11-25T13:00:00Z')],
      clock
    );
    expect(data.quantity).toBe(8);
    expect(delta).toBe(6);
    expect(applied).toEqual(['a']);
    expect(collectedOn(data.farm, TODAY)).toBe(6);
  });

  it('the same version twice counts once', () => {
    const batch = [log('a', 6, '2026-11-25T13:00:00Z')];
    const once = run(fresh(), batch);
    const again = applyFarmEggs(once, batch, clock);
    expect(again.changed).toBe(false);
    expect(again.data).toBe(once);
    expect(again.unchanged).toEqual(['a']);
    expect(again.data.quantity).toBe(6);
  });

  it('an edit moves the stock by the difference only', () => {
    const item = run(
      fresh(),
      [log('a', 6, '2026-11-25T13:00:00Z')],
      [log('a', 9, '2026-11-25T14:00:00Z')]
    );
    expect(item.quantity).toBe(9);
  });

  it('an older version arriving late changes nothing', () => {
    const item = run(
      fresh(),
      [log('a', 9, '2026-11-25T14:00:00Z')],
      [log('a', 6, '2026-11-25T13:00:00Z')]
    );
    expect(item.quantity).toBe(9);
  });

  it('two versions in one batch land oldest first, whatever the order sent', () => {
    const item = run(fresh(), [
      log('a', 9, '2026-11-25T14:00:00Z'),
      log('a', 6, '2026-11-25T13:00:00Z'),
    ]);
    expect(item.quantity).toBe(9);
    expect(item.farm.entries['l:a'].n).toBe(9);
  });

  it('a tombstone takes the eggs back out, and a restore puts them back', () => {
    const deleted = run(
      fresh(),
      [log('a', 6, '2026-11-25T13:00:00Z')],
      [log('a', 6, '2026-11-25T15:00:00Z', { deleted: true })]
    );
    expect(deleted.quantity).toBe(0);
    const restored = run(deleted, [log('a', 6, '2026-11-25T16:00:00Z')]);
    expect(restored.quantity).toBe(6);
  });

  it('given and sold go down, kept does not', () => {
    const item = run(fresh(), [
      log('a', 12, '2026-11-25T13:00:00Z'),
      gone('g', 4, 'given', '2026-11-25T13:10:00Z'),
      gone('s', 2, 'sold', '2026-11-25T13:20:00Z'),
      gone('k', 6, 'kept', '2026-11-25T13:30:00Z'),
    ]);
    expect(item.quantity).toBe(6);
  });

  it('a disposition changed from kept to sold takes the eggs out then', () => {
    const item = run(
      fresh(12),
      [gone('k', 6, 'kept', '2026-11-25T13:30:00Z')],
      [gone('k', 6, 'sold', '2026-11-25T14:30:00Z')]
    );
    expect(item.quantity).toBe(6);
  });

  it('composes with cooking: the farm moves the stock only by its own change', () => {
    const after = run(fresh(), [log('a', 6, '2026-11-25T13:00:00Z')]);
    const cooked = { ...after, quantity: after.quantity - 4 };
    const edited = run(cooked, [log('a', 7, '2026-11-25T15:00:00Z')]);
    expect(edited.quantity).toBe(3);
  });

  it('never takes the stock below zero', () => {
    const item = run(fresh(1), [gone('g', 6, 'given', '2026-11-25T13:00:00Z')]);
    expect(item.quantity).toBe(0);
  });

  it('ignores a record dated before the kitchen tracked farm eggs', () => {
    const old = log('old', 6, '2026-11-25T13:00:00Z', { date: '2026-10-01' });
    const { data, ignored, applied } = applyFarmEggs(fresh(), [old], clock);
    expect(applied).toEqual([]);
    expect(ignored).toEqual([{ id: 'old', reason: expect.any(String) }]);
    expect(data.quantity).toBe(0);
  });

  it('drops ledger entries past the retention window and moves the horizon', () => {
    const item = fresh();
    item.farm.horizon = '2026-01-01';
    item.farm.entries = { 'l:ancient': { v: 1, n: 5, d: '2026-02-01' } };
    const next = run(item, [log('a', 1, '2026-11-25T13:00:00Z')]);
    expect(next.farm.entries['l:ancient']).toBeUndefined();
    expect(next.farm.horizon).toBe(addDays(TODAY, -120));
  });

  it('a box filled from empty keeps from today', () => {
    const empty = { ...fresh(), expiresAt: { $ts: 0 } };
    const next = run(empty, [log('a', 6, '2026-11-25T13:00:00Z')]);
    expect(next.expiresAt.$ts).toBeGreaterThan(NOW.getTime());
  });
});

describe('parseBatch', () => {
  it('keeps good records and reports bad ones without refusing the batch', () => {
    const { records, rejected } = parseBatch({
      records: [
        {
          id: '01KA',
          type: 'log',
          version: '2026-11-25T13:00:00Z',
          date: TODAY,
          quantity: 6,
        },
        { id: '01KB', type: 'disposition', version: 'x', date: TODAY, quantity: 1, kind: 'sold' },
        { id: '01KC', type: 'disposition', version: TODAY, date: TODAY, quantity: 1, kind: 'ate' },
      ],
    });
    expect(records.map((r) => r.id)).toEqual(['01KA']);
    expect(records[0].version).toBe(Date.parse('2026-11-25T13:00:00Z'));
    expect(rejected.map((r) => r.id)).toEqual(['01KB', '01KC']);
  });

  it('refuses something that is not a batch', () => {
    expect(() => parseBatch({})).toThrow(FarmEggsError);
    expect(() => parseBatch({ records: [] })).toThrow(FarmEggsError);
    expect(() => parseBatch({ records: new Array(201).fill({}) })).toThrow(/at most/);
  });
});

describe('picking the item and the fridge', () => {
  const row = (path, data) => ({ path, data });
  it('prefers the farm-fed item, then a fridge one', () => {
    const rows = [
      row('inventory/1', { name: 'Eggs', locationType: 'pantry' }),
      row('inventory/2', { name: 'eggs', locationType: 'fridge' }),
      row('inventory/3', { name: 'Eggplant', locationType: 'fridge' }),
    ];
    expect(pickEggsItem(rows).path).toBe('inventory/2');
    rows.push(row(`inventory/${EGGS_ITEM_ID}`, { name: 'Eggs', farm: { source: 'galaxyfarm' } }));
    expect(pickEggsItem(rows).path).toBe(`inventory/${EGGS_ITEM_ID}`);
    expect(pickEggsItem([row('inventory/3', { name: 'Eggplant' })])).toBeNull();
  });

  it('chooses the default fridge', () => {
    const locations = [
      row('storageLocations/f', { type: 'freezer', isDefault: true, order: 0 }),
      row('storageLocations/s', { type: 'fridge', isDefault: false, order: 6 }),
      row('storageLocations/m', { type: 'fridge', isDefault: true, order: 1 }),
    ];
    expect(pickFridge(locations)).toEqual({ id: 'm' });
    expect(pickFridge([])).toBeNull();
  });
});

describe('isFarmSupplied and dayIn', () => {
  it('is true within a fortnight of the last collection', () => {
    const item = run(fresh(), [log('a', 6, '2026-11-25T13:00:00Z')]);
    expect(isFarmSupplied(item, TODAY)).toBe(true);
    expect(isFarmSupplied(item, '2026-12-09')).toBe(true);
    expect(isFarmSupplied(item, '2026-12-10')).toBe(false);
    expect(isFarmSupplied({ name: 'Eggs' }, TODAY)).toBe(false);
  });

  it('reads the day in the given zone', () => {
    const late = new Date('2026-11-26T03:00:00Z');
    expect(dayIn(late, 'America/Chicago')).toBe('2026-11-25');
    expect(dayIn(late, 'UTC')).toBe('2026-11-26');
  });
});
