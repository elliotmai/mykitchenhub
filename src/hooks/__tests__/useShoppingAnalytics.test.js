// The analytics engine. The reductions are pure, so most of this exercises them
// directly against awkward data — no prices, no stores, one item recorded in two
// places, a counter that disagrees with the history.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useShoppingAnalytics, {
  buildPurchaseRecords,
  buildPurchaseCounts,
  buildFrequentItems,
  buildStoreStats,
  buildMonthlySpend,
  buildTotals,
  TREND_MONTHS,
} from '../useShoppingAnalytics';
import { AuthProvider } from '../useAuth';
import { toDate } from '../../utils/timestamps';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import {
  asDocs,
  makeItem,
  makeItemWithPurchases,
  makePurchase,
  makeUserProfile,
} from '../../test-utils/factories';
import { expectHumanError } from '../../test-utils/humanErrors';

const UID = 'test-uid';
const INVENTORY_PATH = `users/${UID}/inventory`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const renderAnalytics = async (items = []) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useShoppingAnalytics(), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(INVENTORY_PATH, asDocs(items));
  });
  return view;
};

// The same parser the product uses, so a bare `2026-07-04` in a fixture means
// the 4th of July wherever the suite runs. `new Date('2026-07-04')` is midnight
// UTC, which is the 3rd in New York — a fixture that lands in the wrong month.
const at = (value) => toDate(value);

// ---------------------------------------------------------------------------
// buildPurchaseRecords
// ---------------------------------------------------------------------------

describe('buildPurchaseRecords', () => {
  it('flattens every history entry across every item', () => {
    const records = buildPurchaseRecords([
      makeItemWithPurchases([makePurchase(), makePurchase({ store: 'Aldi' })], { name: 'Milk' }),
      makeItemWithPurchases([makePurchase({ store: 'Target' })], { name: 'Rice' }),
    ]);

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.store)).toEqual(['Costco', 'Aldi', 'Target']);
  });

  it('returns nothing for items that have never recorded a purchase', () => {
    expect(buildPurchaseRecords([makeItem({ purchaseHistory: [] })])).toEqual([]);
    expect(buildPurchaseRecords([makeItem({ purchaseHistory: undefined })])).toEqual([]);
  });

  it('handles an empty or missing inventory', () => {
    expect(buildPurchaseRecords()).toEqual([]);
    expect(buildPurchaseRecords([])).toEqual([]);
  });

  it('falls back to the item date when a purchase has none of its own', () => {
    const [record] = buildPurchaseRecords([
      makeItemWithPurchases([makePurchase({ addedAt: null })], { addedAt: at('2026-05-02') }),
    ]);

    expect(record.date).toEqual(at('2026-05-02'));
  });

  it('nulls a price that is missing, negative, or not a number', () => {
    const records = buildPurchaseRecords([
      makeItemWithPurchases([
        makePurchase({ price: null }),
        makePurchase({ price: -3 }),
        makePurchase({ price: 'four dollars' }),
        makePurchase({ price: 0 }),
      ]),
    ]);

    expect(records.map((r) => r.price)).toEqual([null, null, null, 0]);
  });

  it('names an item with no name rather than rendering a blank row', () => {
    const [record] = buildPurchaseRecords([
      makeItemWithPurchases([makePurchase()], { name: '   ', normalized: '' }),
    ]);

    expect(record.name).toBe('Unnamed item');
  });
});

// ---------------------------------------------------------------------------
// buildPurchaseCounts
// ---------------------------------------------------------------------------

describe('buildPurchaseCounts', () => {
  it('adds up the same ingredient stored in two places', () => {
    const counts = buildPurchaseCounts([
      makeItem({ name: 'Chicken', normalized: 'chicken', totalTimesPurchased: 3 }),
      makeItem({ name: 'Chicken', normalized: 'chicken', totalTimesPurchased: 2 }),
    ]);

    expect(counts.size).toBe(1);
    expect(counts.get('chicken').purchases).toBe(5);
  });

  it('counts an item whose history is empty but whose counter is not', () => {
    const counts = buildPurchaseCounts([
      makeItem({ name: 'Rice', purchaseHistory: [], totalTimesPurchased: 4 }),
    ]);

    expect(counts.get('rice').purchases).toBe(4);
  });

  it('trusts the longer history when the counter has fallen behind', () => {
    const counts = buildPurchaseCounts([
      makeItemWithPurchases([makePurchase(), makePurchase(), makePurchase()], {
        name: 'Eggs',
        normalized: 'eggs',
        totalTimesPurchased: 1,
      }),
    ]);

    expect(counts.get('eggs').purchases).toBe(3);
  });

  it('skips an item that has never been purchased at all', () => {
    const counts = buildPurchaseCounts([makeItem({ purchaseHistory: [], totalTimesPurchased: 0 })]);

    expect(counts.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildFrequentItems
// ---------------------------------------------------------------------------

describe('buildFrequentItems', () => {
  const withPrices = () => [
    makeItemWithPurchases(
      [
        makePurchase({ price: 5, store: 'Costco' }),
        makePurchase({ price: 7, store: 'Costco' }),
        makePurchase({ price: 4, store: 'Aldi' }),
      ],
      { name: 'Milk', normalized: 'milk' }
    ),
    makeItemWithPurchases([makePurchase({ price: 12, store: 'Aldi' })], {
      name: 'Salmon',
      normalized: 'salmon',
    }),
  ];

  it('ranks by how often something is bought', () => {
    const items = withPrices();
    const rows = buildFrequentItems(items, buildPurchaseRecords(items));

    expect(rows.map((r) => r.name)).toEqual(['Milk', 'Salmon']);
    expect(rows[0].purchases).toBe(3);
  });

  it('averages only the purchases that recorded a price', () => {
    const items = [
      makeItemWithPurchases(
        [makePurchase({ price: 6 }), makePurchase({ price: null }), makePurchase({ price: 10 })],
        { name: 'Milk', normalized: 'milk' }
      ),
    ];
    const [row] = buildFrequentItems(items, buildPurchaseRecords(items));

    expect(row.purchases).toBe(3);
    expect(row.averagePrice).toBe(8);
  });

  it('names the store with the lowest average price for that item', () => {
    const items = withPrices();
    const [milk] = buildFrequentItems(items, buildPurchaseRecords(items));

    // Costco averages $6, Aldi $4.
    expect(milk.bestStore).toBe('Aldi');
    expect(milk.bestPrice).toBe(4);
  });

  it('leaves price and store null when nothing was recorded', () => {
    const items = [makeItem({ name: 'Rice', normalized: 'rice', totalTimesPurchased: 2 })];
    const [row] = buildFrequentItems(items, buildPurchaseRecords(items));

    expect(row.purchases).toBe(2);
    expect(row.averagePrice).toBeNull();
    expect(row.bestStore).toBeNull();
    expect(row.bestPrice).toBeNull();
  });

  it('reports one purchase as one purchase, not as an average of nothing', () => {
    const items = [
      makeItemWithPurchases([makePurchase({ price: 6.5, store: 'Aldi' })], {
        name: 'Oats',
        normalized: 'oats',
      }),
    ];
    const [row] = buildFrequentItems(items, buildPurchaseRecords(items));

    expect(row).toMatchObject({
      purchases: 1,
      spend: 6.5,
      averagePrice: 6.5,
      bestStore: 'Aldi',
      bestPrice: 6.5,
    });
    expect(Number.isFinite(row.averagePrice)).toBe(true);
  });

  it('averages what was paid per trip, and claims no unit, when units differ', () => {
    // A gallon of milk and a 64oz bottle are not comparable per unit, and
    // nothing here converts between them. The average is what reached the till
    // on a shopping trip — so no row may advertise a unit only some of its
    // purchases used.
    const items = [
      makeItemWithPurchases(
        [
          makePurchase({ price: 4, unit: 'gal', quantity: 1 }),
          makePurchase({ price: 2, unit: 'oz', quantity: 64 }),
        ],
        { name: 'Milk', normalized: 'milk', unit: 'gal' }
      ),
    ];
    const [row] = buildFrequentItems(items, buildPurchaseRecords(items));

    expect(row.averagePrice).toBe(3);
    expect(row.spend).toBe(6);
    expect(row).not.toHaveProperty('unit');
  });

  it('does not divide by zero when an item is priced only at one store', () => {
    const items = [
      makeItemWithPurchases([makePurchase({ price: 0, store: 'Aldi' })], {
        name: 'Free Sample',
        normalized: 'free sample',
      }),
    ];
    const [row] = buildFrequentItems(items, buildPurchaseRecords(items));

    // Zero is a price, not a missing price.
    expect(row.averagePrice).toBe(0);
    expect(row.bestStore).toBe('Aldi');
  });

  it('carries a very long name through untouched, for the chart to shorten', () => {
    const name = 'Organic free-range boneless skinless chicken thighs, family pack';
    const items = [
      makeItemWithPurchases([makePurchase({ price: 12 })], {
        name,
        normalized: name.toLowerCase(),
      }),
    ];
    const [row] = buildFrequentItems(items, buildPurchaseRecords(items));

    expect(row.name).toBe(name);
  });

  it('buckets priced purchases with no store under "Unspecified"', () => {
    const items = [
      makeItemWithPurchases([makePurchase({ price: 3, store: '' })], {
        name: 'Bread',
        normalized: 'bread',
      }),
    ];
    const [row] = buildFrequentItems(items, buildPurchaseRecords(items));

    expect(row.bestStore).toBe('Unspecified');
  });

  it('breaks a tie alphabetically so the order is stable between renders', () => {
    const items = [
      makeItem({ name: 'Zucchini', normalized: 'zucchini', totalTimesPurchased: 2 }),
      makeItem({ name: 'Apples', normalized: 'apples', totalTimesPurchased: 2 }),
    ];

    expect(buildFrequentItems(items, []).map((r) => r.name)).toEqual(['Apples', 'Zucchini']);
  });

  it('caps the list so a big pantry does not produce a 200-row chart', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({ name: `Item ${i}`, normalized: `item-${i}`, totalTimesPurchased: 20 - i })
    );

    expect(buildFrequentItems(items, [], 5)).toHaveLength(5);
  });

  it('returns nothing for an empty kitchen', () => {
    expect(buildFrequentItems([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildStoreStats
// ---------------------------------------------------------------------------

describe('buildStoreStats', () => {
  it('totals spend and trips per store, biggest spend first', () => {
    const items = [
      makeItemWithPurchases([
        makePurchase({ price: 10, store: 'Aldi' }),
        makePurchase({ price: 30, store: 'Costco' }),
        makePurchase({ price: 20, store: 'Costco' }),
      ]),
    ];

    const stores = buildStoreStats(buildPurchaseRecords(items));

    expect(stores.map((s) => s.store)).toEqual(['Costco', 'Aldi']);
    expect(stores[0]).toMatchObject({ purchases: 2, spend: 50, averagePrice: 25 });
  });

  it('ignores purchases with no store recorded', () => {
    const items = [makeItemWithPurchases([makePurchase({ store: '' })])];
    expect(buildStoreStats(buildPurchaseRecords(items))).toEqual([]);
  });

  it('counts a trip with no price but leaves the average null', () => {
    const items = [makeItemWithPurchases([makePurchase({ price: null, store: 'Aldi' })])];
    const [store] = buildStoreStats(buildPurchaseRecords(items));

    expect(store).toMatchObject({ purchases: 1, spend: 0, averagePrice: null });
  });

  it('handles no records at all', () => {
    expect(buildStoreStats()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildMonthlySpend
// ---------------------------------------------------------------------------

describe('buildMonthlySpend', () => {
  const now = at('2026-08-14T12:00:00');

  it('keeps a slot for every month in the window, even the quiet ones', () => {
    const months = buildMonthlySpend([], TREND_MONTHS, now);

    expect(months).toHaveLength(TREND_MONTHS);
    expect(months.map((m) => m.label)).toEqual(['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']);
    expect(months.every((m) => m.spend === 0)).toBe(true);
  });

  it('sums the prices that fall in each month', () => {
    const records = [
      { date: at('2026-07-04'), price: 10 },
      { date: at('2026-07-20'), price: 5.5 },
      { date: at('2026-08-01'), price: 3 },
    ];

    const months = buildMonthlySpend(records, TREND_MONTHS, now);
    const byLabel = Object.fromEntries(months.map((m) => [m.label, m]));

    expect(byLabel.Jul).toMatchObject({ spend: 15.5, purchases: 2 });
    expect(byLabel.Aug).toMatchObject({ spend: 3, purchases: 1 });
  });

  it('counts an unpriced purchase as a trip but not as spend', () => {
    const months = buildMonthlySpend([{ date: at('2026-08-02'), price: null }], TREND_MONTHS, now);
    const august = months[months.length - 1];

    expect(august).toMatchObject({ spend: 0, purchases: 1 });
  });

  it('drops anything outside the window or without a usable date', () => {
    const months = buildMonthlySpend(
      [
        { date: at('2024-01-01'), price: 999 },
        { date: null, price: 999 },
      ],
      TREND_MONTHS,
      now
    );

    expect(months.reduce((sum, m) => sum + m.spend, 0)).toBe(0);
  });

  it('leaves the quiet months as zero rather than as a gap in the line', () => {
    // One purchase, five silent months. Every slot still has a number, so the
    // line reads "spent nothing" instead of breaking or interpolating.
    const months = buildMonthlySpend([{ date: at('2026-08-02'), price: 9 }], TREND_MONTHS, now);

    expect(months).toHaveLength(TREND_MONTHS);
    expect(months.every((m) => Number.isFinite(m.spend))).toBe(true);
    expect(months.slice(0, -1).map((m) => m.spend)).toEqual([0, 0, 0, 0, 0]);
    expect(months[months.length - 1].spend).toBe(9);
  });

  it('gives every month a label a reader can put a name to', () => {
    const months = buildMonthlySpend([], TREND_MONTHS, now);

    expect(months.every((m) => typeof m.label === 'string' && m.label.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildTotals
// ---------------------------------------------------------------------------

describe('buildTotals', () => {
  it('summarises spend, purchases, items and stores', () => {
    const items = [
      makeItemWithPurchases(
        [makePurchase({ price: 10, store: 'Aldi' }), makePurchase({ price: 5, store: 'Costco' })],
        { name: 'Milk', normalized: 'milk' }
      ),
      makeItemWithPurchases([makePurchase({ price: null, store: 'Aldi' })], {
        name: 'Rice',
        normalized: 'rice',
      }),
    ];

    expect(buildTotals(items, buildPurchaseRecords(items))).toEqual({
      itemsTracked: 2,
      purchases: 3,
      spend: 15,
      pricedPurchases: 2,
      averagePrice: 7.5,
      storesUsed: 2,
    });
  });

  it('counts one store as one store, however many trips were made to it', () => {
    const items = [
      makeItemWithPurchases(
        [makePurchase({ price: 3, store: 'Aldi' }), makePurchase({ price: 5, store: 'Aldi' })],
        { name: 'Milk', normalized: 'milk' }
      ),
    ];

    expect(buildTotals(items, buildPurchaseRecords(items))).toMatchObject({
      storesUsed: 1,
      purchases: 2,
      averagePrice: 4,
    });
  });

  it('never reports NaN or Infinity, whatever the history holds', () => {
    const items = [
      makeItemWithPurchases([makePurchase({ price: null, store: '' })], {
        name: 'Rice',
        normalized: 'rice',
      }),
    ];
    const totals = buildTotals(items, buildPurchaseRecords(items));

    expect(totals.spend).toBe(0);
    expect(totals.averagePrice).toBeNull();
    expect(totals.storesUsed).toBe(0);
    const numbers = Object.values(totals).filter((value) => typeof value === 'number');
    expect(numbers.every(Number.isFinite)).toBe(true);
  });

  it('is all zeroes and nulls for an empty kitchen', () => {
    expect(buildTotals([], [])).toEqual({
      itemsTracked: 0,
      purchases: 0,
      spend: 0,
      pricedPurchases: 0,
      averagePrice: null,
      storesUsed: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

describe('useShoppingAnalytics', () => {
  it('derives everything from the live inventory', async () => {
    const { result } = await renderAnalytics([
      makeItemWithPurchases(
        [makePurchase({ price: 8, store: 'Aldi' }), makePurchase({ price: 4, store: 'Aldi' })],
        { name: 'Milk', normalized: 'milk' }
      ),
    ]);

    expect(result.current.totals.spend).toBe(12);
    expect(result.current.frequentItems[0].name).toBe('Milk');
    expect(result.current.stores[0].store).toBe('Aldi');
    expect(result.current.hasPurchaseData).toBe(true);
    expect(result.current.hasPriceData).toBe(true);
    expect(result.current.hasStoreData).toBe(true);
  });

  it('reports an empty kitchen without throwing', async () => {
    const { result } = await renderAnalytics([]);

    expect(result.current.hasPurchaseData).toBe(false);
    expect(result.current.hasPriceData).toBe(false);
    expect(result.current.hasStoreData).toBe(false);
    expect(result.current.frequentItems).toEqual([]);
    expect(result.current.monthlySpend).toHaveLength(TREND_MONTHS);
  });

  it('still ranks favourites when no prices were ever recorded', async () => {
    const { result } = await renderAnalytics([
      makeItem({ name: 'Rice', normalized: 'rice', purchaseHistory: [], totalTimesPurchased: 6 }),
    ]);

    expect(result.current.hasPurchaseData).toBe(true);
    expect(result.current.hasPriceData).toBe(false);
    expect(result.current.frequentItems[0]).toMatchObject({ name: 'Rice', purchases: 6 });
  });

  describe('recordPurchase', () => {
    it('appends the purchase and bumps both counters in one write', async () => {
      const { result } = await renderAnalytics([makeItem({ id: 'item-1' })]);

      let outcome;
      await act(async () => {
        outcome = await result.current.recordPurchase('item-1', {
          quantity: 2,
          unit: 'gal',
          price: 3.5,
          store: 'Aldi',
        });
      });

      expect(outcome).toEqual({ success: true });
      expect(fs.pathOf(fs.updateDoc.mock.calls[0][0])).toBe(`${INVENTORY_PATH}/item-1`);

      const patch = fs.updateDoc.mock.calls[0][1];
      expect(patch.totalTimesPurchased).toEqual({ __sentinel: 'increment', by: 1 });
      expect(patch.quantity).toEqual({ __sentinel: 'increment', by: 2 });
      expect(patch.purchaseHistory.__sentinel).toBe('arrayUnion');
      expect(patch.purchaseHistory.values[0]).toMatchObject({
        quantity: 2,
        unit: 'gal',
        price: 3.5,
        store: 'Aldi',
      });
    });

    it('stores a null price rather than NaN when none is given', async () => {
      const { result } = await renderAnalytics([makeItem({ id: 'item-1' })]);

      await act(async () => {
        await result.current.recordPurchase('item-1', { quantity: 1 });
      });

      expect(fs.updateDoc.mock.calls[0][1].purchaseHistory.values[0]).toMatchObject({
        price: null,
        store: '',
        unit: '',
      });
    });

    it.each([
      ['no item id', undefined, { quantity: 1 }, 'Item is required.'],
      ['zero quantity', 'item-1', { quantity: 0 }, 'Quantity must be greater than 0.'],
      ['a missing quantity', 'item-1', {}, 'Quantity must be greater than 0.'],
    ])('refuses %s', async (_label, itemId, payload, error) => {
      const { result } = await renderAnalytics([makeItem({ id: 'item-1' })]);

      let outcome;
      await act(async () => {
        outcome = await result.current.recordPurchase(itemId, payload);
      });

      expect(outcome).toEqual({ success: false, error });
      expect(fs.updateDoc).not.toHaveBeenCalled();
    });

    it('refuses when signed out', async () => {
      authMock.__setUser(null);
      const { result } = renderHook(() => useShoppingAnalytics(), { wrapper });

      let outcome;
      await act(async () => {
        outcome = await result.current.recordPurchase('item-1', { quantity: 1 });
      });

      expect(outcome).toEqual({ success: false, error: 'Not authenticated' });
    });

    it('reports a failed write instead of throwing', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = await renderAnalytics([makeItem({ id: 'item-1' })]);
      fs.updateDoc.mockRejectedValueOnce(new Error('permission-denied'));

      let outcome;
      await act(async () => {
        outcome = await result.current.recordPurchase('item-1', { quantity: 1 });
      });

      expect(outcome.success).toBe(false);
      expectHumanError(outcome.error, /record that purchase/i);
    });
  });
});
