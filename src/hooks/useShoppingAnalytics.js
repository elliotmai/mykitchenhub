// src/hooks/useShoppingAnalytics.js
// Shopping patterns derived from what's already in the pantry.
//
// Every inventory document carries a `purchaseHistory[]` and a
// `totalTimesPurchased` counter (see firestore/SCHEMA_DOCUMENTATION.md). Nothing
// else has to be stored to answer "what do I buy most, what does it cost me, and
// where is it cheapest" — this hook folds that history into the shapes the
// Analytics page renders.
//
// The reductions below are exported separately from the hook so they can be
// tested as plain functions, and so a component can chart a fixed dataset
// without standing up Firestore.

import { useMemo, useCallback } from 'react';
import { doc, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import useInventory from './useInventory';
import { toDate, monthKey, monthLabel, recentMonthKeys } from '../utils/timestamps';

/** How many months the spending trend covers. */
export const TREND_MONTHS = 6;

/** How many rows the "buy most often" chart and table show. */
export const TOP_ITEM_LIMIT = 8;

const toPositiveNumber = (value) => {
  // Number(null) and Number('') are both 0, which would turn "no price
  // recorded" into "cost nothing" — so absent values are rejected up front.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Flatten every recorded purchase across every item into one list of events.
 *
 * An item whose history is empty still counts as bought — `totalTimesPurchased`
 * is the source of truth for *how many times*, and the history array only adds
 * the price/store detail when it was captured.
 */
export const buildPurchaseRecords = (items = []) =>
  items.flatMap((item) => {
    const history = Array.isArray(item?.purchaseHistory) ? item.purchaseHistory : [];
    const name = (typeof item?.name === 'string' && item.name.trim()) || 'Unnamed item';
    const key = (typeof item?.normalized === 'string' && item.normalized) || name.toLowerCase();

    return history.map((entry, index) => ({
      id: `${item?.id ?? key}-${index}`,
      itemKey: key,
      name,
      date: toDate(entry?.addedAt) ?? toDate(item?.addedAt),
      quantity: toPositiveNumber(entry?.quantity),
      unit: (entry?.unit || item?.unit || '').trim(),
      price: toPositiveNumber(entry?.price),
      store: (typeof entry?.store === 'string' ? entry.store : '').trim(),
    }));
  });

/**
 * How many times each item has been bought, keyed by its normalized name.
 *
 * Two documents for "chicken breast" — one in the freezer, one in the fridge —
 * are the same shopping habit, so they're counted together.
 */
export const buildPurchaseCounts = (items = []) => {
  const counts = new Map();

  items.forEach((item) => {
    const name = (typeof item?.name === 'string' && item.name.trim()) || 'Unnamed item';
    const key = (typeof item?.normalized === 'string' && item.normalized) || name.toLowerCase();
    const historyLength = Array.isArray(item?.purchaseHistory) ? item.purchaseHistory.length : 0;
    const declared = toPositiveNumber(item?.totalTimesPurchased) ?? 0;
    // Trust whichever is higher: history can be trimmed, the counter can lag.
    const purchases = Math.max(historyLength, declared);

    if (purchases <= 0) return;

    const existing = counts.get(key);
    if (existing) existing.purchases += purchases;
    else counts.set(key, { key, name, purchases });
  });

  return counts;
};

/**
 * The items bought most often, richest-detail first.
 *
 * `averagePrice` and `bestStore` come only from purchases that recorded a
 * price, so an item bought six times with one price on file still reports six
 * purchases and one honest average.
 *
 * That average is per *purchase*, not per unit. An item bought once as a gallon
 * and once as a 64oz bottle averages what was paid at the till, which is the
 * only comparison the recorded data supports — nothing here converts units, and
 * no row claims a unit that only some of its purchases used.
 */
export const buildFrequentItems = (items = [], records = [], max = TOP_ITEM_LIMIT) => {
  const counts = buildPurchaseCounts(items);
  const detail = new Map();

  records.forEach((record) => {
    if (!detail.has(record.itemKey)) {
      detail.set(record.itemKey, { priced: [], stores: new Map(), lastPurchased: null });
    }
    const d = detail.get(record.itemKey);

    if (record.price !== null) {
      d.priced.push(record.price);
      const store = record.store || 'Unspecified';
      const prices = d.stores.get(store) ?? [];
      prices.push(record.price);
      d.stores.set(store, prices);
    }
    if (record.date && (!d.lastPurchased || record.date > d.lastPurchased)) {
      d.lastPurchased = record.date;
    }
  });

  return [...counts.values()]
    .map((entry) => {
      const d = detail.get(entry.key);
      const priced = d?.priced ?? [];
      const spend = priced.reduce((sum, p) => sum + p, 0);

      let bestStore = null;
      let bestPrice = null;
      (d?.stores ?? new Map()).forEach((prices, store) => {
        const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        if (bestPrice === null || avg < bestPrice) {
          bestPrice = avg;
          bestStore = store;
        }
      });

      return {
        ...entry,
        spend: round2(spend),
        averagePrice: priced.length ? round2(spend / priced.length) : null,
        bestStore,
        bestPrice: bestPrice === null ? null : round2(bestPrice),
        lastPurchased: d?.lastPurchased ?? null,
      };
    })
    .sort((a, b) => b.purchases - a.purchases || a.name.localeCompare(b.name))
    .slice(0, max);
};

/** Spend and trips per store, biggest spend first. */
export const buildStoreStats = (records = []) => {
  const stores = new Map();

  records.forEach((record) => {
    if (!record.store) return;
    const entry = stores.get(record.store) ?? { store: record.store, purchases: 0, priced: [] };
    entry.purchases += 1;
    if (record.price !== null) entry.priced.push(record.price);
    stores.set(record.store, entry);
  });

  return [...stores.values()]
    .map(({ store, purchases, priced }) => {
      const spend = priced.reduce((sum, p) => sum + p, 0);
      return {
        store,
        purchases,
        spend: round2(spend),
        averagePrice: priced.length ? round2(spend / priced.length) : null,
      };
    })
    .sort((a, b) => b.spend - a.spend || b.purchases - a.purchases);
};

/**
 * Spend per month for the trailing `months` months, oldest first.
 *
 * Months with no purchases are kept as zeroes so the axis stays evenly spaced
 * and a gap reads as "spent nothing" rather than as missing data.
 */
export const buildMonthlySpend = (records = [], months = TREND_MONTHS, now = new Date()) => {
  const buckets = new Map(
    recentMonthKeys(months, now).map((key) => [key, { spend: 0, purchases: 0 }])
  );

  records.forEach((record) => {
    const key = monthKey(record.date);
    if (!key || !buckets.has(key)) return;
    const bucket = buckets.get(key);
    bucket.purchases += 1;
    if (record.price !== null) bucket.spend += record.price;
  });

  return [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: monthLabel(key, now),
    spend: round2(bucket.spend),
    purchases: bucket.purchases,
  }));
};

/** Headline numbers for the stat tiles. */
export const buildTotals = (items = [], records = []) => {
  const priced = records.filter((r) => r.price !== null);
  const spend = priced.reduce((sum, r) => sum + r.price, 0);
  const counts = buildPurchaseCounts(items);
  const purchases = [...counts.values()].reduce((sum, entry) => sum + entry.purchases, 0);

  return {
    itemsTracked: counts.size,
    purchases,
    spend: round2(spend),
    pricedPurchases: priced.length,
    averagePrice: priced.length ? round2(spend / priced.length) : null,
    storesUsed: new Set(records.map((r) => r.store).filter(Boolean)).size,
  };
};

/**
 * useShoppingAnalytics Hook
 *
 * Usage:
 *   const { totals, frequentItems, stores, monthlySpend, loading } =
 *     useShoppingAnalytics();
 *
 * Reads the live inventory, so the page updates as soon as something is added.
 */
const useShoppingAnalytics = ({ now } = {}) => {
  const { user } = useAuth();
  const { items, loading, error } = useInventory();

  const records = useMemo(() => buildPurchaseRecords(items), [items]);
  const totals = useMemo(() => buildTotals(items, records), [items, records]);
  const frequentItems = useMemo(() => buildFrequentItems(items, records), [items, records]);
  const stores = useMemo(() => buildStoreStats(records), [records]);
  const monthlySpend = useMemo(
    () => buildMonthlySpend(records, TREND_MONTHS, now ?? new Date()),
    [records, now]
  );

  /**
   * Append a restock to an item's history.
   *
   * This is the write side of the purchase tracking the analytics read: it adds
   * one `purchaseHistory` entry, bumps `totalTimesPurchased`, and raises the
   * item's quantity, all in one update so the three can't drift apart.
   */
  const recordPurchase = useCallback(
    async (itemId, { quantity, unit, price, store } = {}) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };
      if (!itemId) return { success: false, error: 'Item is required.' };

      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0)
        return { success: false, error: 'Quantity must be greater than 0.' };

      try {
        await updateDoc(doc(db, 'users', user.uid, 'inventory', itemId), {
          // serverTimestamp() is rejected inside an array, so this is client time
          // — the same thing useInventory.addItem writes for the first purchase.
          purchaseHistory: arrayUnion({
            addedAt: new Date(),
            quantity: qty,
            unit: unit || '',
            price: toPositiveNumber(price),
            store: store || '',
          }),
          totalTimesPurchased: increment(1),
          quantity: increment(qty),
        });
        return { success: true };
      } catch (err) {
        console.error('Error recording purchase:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  return {
    loading,
    error,
    records,
    totals,
    frequentItems,
    stores,
    monthlySpend,
    hasPurchaseData: totals.purchases > 0,
    hasPriceData: totals.pricedPurchases > 0,
    hasStoreData: stores.length > 0,
    recordPurchase,
  };
};

export default useShoppingAnalytics;
