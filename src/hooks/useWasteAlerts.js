// src/hooks/useWasteAlerts.js
// The "what is about to be thrown away?" view of the inventory — roadmap 6.1
// and 6.3.
//
// Groups expiring items by urgency, works out which of them the freezer would
// actually save (and by how many days), and performs the freeze itself.

import { useCallback, useMemo } from 'react';

import useInventory, {
  EXPIRATION_LEVELS,
  byExpirySoonestFirst,
  getDaysUntilExpiration,
  getExpirationStatus,
  resolveShelfLifeDays,
} from './useInventory';
import useStorageLocations from './useStorageLocations';
import { lookupShelfLife } from './useIngredientMetadata';

/** Items expiring this many days out are worth a warning. */
export const DEFAULT_ALERT_WINDOW_DAYS = 5;

/** Freezing something that already keeps this long is not worth suggesting. */
export const MIN_DAYS_GAINED_BY_FREEZING = 7;

/**
 * Can this item be frozen, and what would it buy?
 *
 * Returns null when freezing makes no sense: the item is already frozen, the
 * shelf-life table says the ingredient does not freeze (lettuce turns to
 * slime), or the gain is too small to be worth a tap.
 */
export const getFreezerBenefit = (item) => {
  if (!item || item.locationType === 'freezer') return null;

  const known = lookupShelfLife(item.name, 'freezer');
  if (known === null) return null; // the table knows it, and says don't

  const frozenDays = resolveShelfLifeDays(item.name, 'freezer');
  const daysLeft = getDaysUntilExpiration(item.expiresAt);
  const remaining = daysLeft === null ? 0 : Math.max(daysLeft, 0);
  const daysGained = frozenDays - remaining;

  if (daysGained < MIN_DAYS_GAINED_BY_FREEZING) return null;

  return { frozenDays, daysLeft: remaining, daysGained };
};

/** Half of a quantity, rounded to something a kitchen scale could read. */
export const halfOf = (quantity) => Math.round((Number(quantity) / 2) * 100) / 100;

/**
 * useWasteAlerts
 *
 * @param {object} options
 * @param {number} options.withinDays - how far ahead to look (default 5)
 */
const useWasteAlerts = ({ withinDays = DEFAULT_ALERT_WINDOW_DAYS } = {}) => {
  const { items, loading: itemsLoading, error, addItem, updateItem } = useInventory();
  const { locations, loading: locationsLoading } = useStorageLocations();

  const expiringItems = useMemo(
    () =>
      items
        .filter((item) => {
          // Already-expired items have a negative day count, so they are
          // caught by the same comparison.
          const days = getDaysUntilExpiration(item.expiresAt);
          return days !== null && days <= withinDays;
        })
        .sort(byExpirySoonestFirst),
    [items, withinDays]
  );

  /** The same items, split into the buckets the colour-coding uses. */
  const buckets = useMemo(() => {
    const grouped = { expired: [], critical: [], warning: [] };
    expiringItems.forEach((item) => {
      const status = getExpirationStatus(item.expiresAt);
      if (grouped[status]) grouped[status].push(item);
    });
    return grouped;
  }, [expiringItems]);

  const counts = useMemo(
    () => ({
      expired: buckets.expired.length,
      critical: buckets.critical.length,
      warning: buckets.warning.length,
      total: expiringItems.length,
    }),
    [buckets, expiringItems]
  );

  /** Where a frozen item should go: the default freezer, else any freezer. */
  const freezerLocation = useMemo(() => {
    const freezers = locations.filter((l) => l.type === 'freezer');
    return freezers.find((l) => l.isDefault) ?? freezers[0] ?? null;
  }, [locations]);

  /** Expiring items the freezer would rescue, best saving first. */
  const freezerSuggestions = useMemo(
    () =>
      expiringItems
        .map((item) => {
          const benefit = getFreezerBenefit(item);
          return benefit ? { item, ...benefit } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.daysGained - a.daysGained),
    [expiringItems]
  );

  /**
   * Move the whole item into the freezer.
   *
   * The expiry is not passed in: useInventory recalculates it from the new
   * location, which is the whole point of freezing something.
   */
  const freezeAll = useCallback(
    async (item) => {
      if (!freezerLocation) {
        return { success: false, error: 'Add a freezer in Settings first.' };
      }
      return updateItem(item.id, {
        locationId: freezerLocation.id,
        locationType: 'freezer',
      });
    },
    [freezerLocation, updateItem]
  );

  /**
   * Freeze half and leave the rest where it is — for the cook who wants
   * chicken tonight and chicken next month.
   */
  const freezeHalf = useCallback(
    async (item) => {
      if (!freezerLocation) {
        return { success: false, error: 'Add a freezer in Settings first.' };
      }

      const quantity = Number(item.quantity);
      const half = halfOf(quantity);
      if (!quantity || half <= 0 || quantity < 2) {
        return { success: false, error: 'There is not enough here to split. Freeze all instead.' };
      }

      // Create the frozen half first: if that write fails, the cook still has
      // the whole item where they left it. The other order could quietly halve
      // their inventory.
      const frozen = await addItem({
        name: item.name,
        quantity: half,
        unit: item.unit,
        locationId: freezerLocation.id,
        locationType: 'freezer',
        notes: item.notes,
      });
      if (!frozen?.success) return frozen;

      const kept = await updateItem(item.id, { quantity: quantity - half });
      if (!kept?.success) return kept;

      return { success: true, frozenQuantity: half, remainingQuantity: quantity - half };
    },
    [addItem, freezerLocation, updateItem]
  );

  return {
    loading: itemsLoading || locationsLoading,
    error,
    items,
    locations,
    expiringItems,
    buckets,
    counts,
    levels: EXPIRATION_LEVELS,
    freezerLocation,
    freezerSuggestions,
    freezeAll,
    freezeHalf,
  };
};

export default useWasteAlerts;
