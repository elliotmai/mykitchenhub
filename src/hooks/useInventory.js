// src/hooks/useInventory.js
// Custom hook for real-time inventory management
// Provides CRUD operations and Firestore real-time sync

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import { lookupShelfLife } from './useIngredientMetadata';

// ---------------------------------------------------------------------------
// Shelf life defaults (days) by location type
//
// Used when the ingredient shelf-life table has never heard of an item. When it
// *has* heard of it, `resolveShelfLifeDays` prefers the per-ingredient number:
// chicken keeps for 2 days in the fridge, ketchup for 180, and one blanket
// number for "fridge" would be wrong for both.
// ---------------------------------------------------------------------------
export const SHELF_LIFE_DEFAULTS = {
  freezer: 180,
  fridge: 7,
  pantry: 90,
};

/** Last-resort shelf life when even the location type is unrecognised. */
export const FALLBACK_SHELF_LIFE_DAYS = 30;

/**
 * How an item's stored `shelfLifeDays` came to be:
 *
 *   'default' — we calculated it, so we may recalculate it when things change
 *   'custom'  — the cook typed it in, so it is theirs and we leave it alone
 *
 * Without this, moving an item to the freezer could not extend its life: the
 * hook had no way to tell a number it had picked from one a person had.
 */
export const SHELF_LIFE_SOURCES = {
  DEFAULT: 'default',
  CUSTOM: 'custom',
};

// ---------------------------------------------------------------------------
// Shelf life lookup by ingredient + location (roadmap 6.1)
// ---------------------------------------------------------------------------

/**
 * Days an ingredient keeps in a given location.
 *
 * Falls back to the location default both when the ingredient is unknown and
 * when the table says it does not belong there at all — an item the cook has
 * actually put in the pantry still needs *some* expiry date.
 */
export const resolveShelfLifeDays = (name, locationType) => {
  const known = lookupShelfLife(name, locationType);
  if (typeof known === 'number') return known;

  return SHELF_LIFE_DEFAULTS[locationType] ?? FALLBACK_SHELF_LIFE_DAYS;
};

/** True when a caller actually supplied a shelf life, rather than leaving it blank. */
export const hasExplicitShelfLife = (value) =>
  value !== undefined && value !== null && value !== '' && !Number.isNaN(Number(value));

/**
 * Did a person choose this item's shelf life, or did we?
 *
 * Documents written before `shelfLifeSource` existed carry no answer, so they
 * are compared against what the lookup would have produced: a value that
 * matches was ours, anything else was deliberate.
 */
export const isCustomShelfLife = (item) => {
  if (!item) return false;
  if (item.shelfLifeSource === SHELF_LIFE_SOURCES.CUSTOM) return true;
  if (item.shelfLifeSource === SHELF_LIFE_SOURCES.DEFAULT) return false;

  if (item.shelfLifeDays === null || item.shelfLifeDays === undefined) return false;
  return Number(item.shelfLifeDays) !== resolveShelfLifeDays(item.name, item.locationType);
};

// ---------------------------------------------------------------------------
// Helper: calculate expiresAt from locationType + addedAt
// ---------------------------------------------------------------------------
export const calcExpiresAt = (locationType, shelfLifeDays) => {
  const days = shelfLifeDays ?? SHELF_LIFE_DEFAULTS[locationType] ?? FALLBACK_SHELF_LIFE_DAYS;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

// ---------------------------------------------------------------------------
// Helper: days between now and an expiry (Firestore Timestamp, Date or string)
// ---------------------------------------------------------------------------
export const toDate = (value) => {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getDaysUntilExpiration = (expiresAt) => {
  const exp = toDate(expiresAt);
  if (!exp) return null;
  return Math.ceil((exp - new Date()) / (1000 * 60 * 60 * 24));
};

// ---------------------------------------------------------------------------
// Helper: expiration status from expiresAt timestamp
// Returns: 'expired' | 'critical' | 'warning' | 'safe'
// ---------------------------------------------------------------------------
export const getExpirationStatus = (expiresAt) => {
  if (!expiresAt) return 'safe';
  const days = getDaysUntilExpiration(expiresAt);
  if (days === null) return 'safe';

  if (days < 0) return 'expired';
  if (days <= 2) return 'critical';
  if (days <= 5) return 'warning';
  return 'safe';
};

// ---------------------------------------------------------------------------
// Expiration colour-coding system (roadmap 6.1)
//
// One table so the inventory card, the waste-alerts page and the freezer
// suggestions all agree on what "critical" looks like and what it means. The
// colours are design-system tokens, defined in src/styles/design-system.css.
// ---------------------------------------------------------------------------
export const EXPIRATION_LEVELS = {
  expired: {
    status: 'expired',
    label: 'Expired',
    rank: 0,
    cardClass: 'expiration-critical',
    variant: 'danger',
    background: 'var(--mkh-expiring-critical)',
    foreground: 'var(--mkh-danger-text)',
    warning: 'Past its date — check it before you cook with it.',
  },
  critical: {
    status: 'critical',
    label: 'Critical',
    rank: 1,
    cardClass: 'expiration-critical',
    variant: 'danger',
    background: 'var(--mkh-expiring-critical)',
    foreground: 'var(--mkh-danger-text)',
    warning: 'Use it in the next day or two, or move it to the freezer.',
  },
  warning: {
    status: 'warning',
    label: 'Soon',
    rank: 2,
    cardClass: 'expiration-warning',
    variant: 'warning',
    background: 'var(--mkh-expiring-warning)',
    foreground: 'var(--mkh-warning-text)',
    warning: 'Plan a meal around this one this week.',
  },
  safe: {
    status: 'safe',
    label: 'Fresh',
    rank: 3,
    cardClass: 'expiration-safe',
    variant: 'success',
    background: 'var(--mkh-expiring-safe)',
    foreground: 'var(--mkh-success-text)',
    warning: null,
  },
};

/** The colour-coding entry for an expiry date. Never returns undefined. */
export const getExpirationLevel = (expiresAt) =>
  EXPIRATION_LEVELS[getExpirationStatus(expiresAt)] ?? EXPIRATION_LEVELS.safe;

/** Inline badge styling for an expiry, shared by every card in the app. */
export const getExpirationBadgeStyle = (expiresAt) => {
  const level = getExpirationLevel(expiresAt);
  return {
    background: level.background,
    color: level.foreground,
    border: `1px solid ${level.foreground}`,
  };
};

/** Soonest-first, so the thing most at risk of being thrown away is on top. */
export const byExpirySoonestFirst = (a, b) => {
  const aDate = toDate(a?.expiresAt);
  const bDate = toDate(b?.expiresAt);
  if (!aDate && !bDate) return 0;
  if (!aDate) return 1;
  if (!bDate) return -1;
  return aDate - bDate;
};

// ---------------------------------------------------------------------------
// Helper: human-readable expiration label
// ---------------------------------------------------------------------------
export const getExpirationLabel = (expiresAt) => {
  if (!expiresAt) return 'No expiry';
  const now = new Date();
  const exp = expiresAt?.toDate ? expiresAt.toDate() : new Date(expiresAt);
  const days = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days <= 30) return `Expires in ${days}d`;
  return exp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * useInventory Hook
 *
 * Manages inventory items with real-time Firestore updates.
 *
 * Usage:
 * const {
 *   items, loading, error,
 *   addItem, updateItem, deleteItem
 * } = useInventory();
 */
const useInventory = () => {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---------------------------------------------------------------------------
  // Real-time listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user?.uid) {
      setItems([]);
      setLoading(false);
      return;
    }

    const inventoryRef = collection(db, 'users', user.uid, 'inventory');
    const q = query(inventoryRef, orderBy('name', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setItems(docs);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching inventory:', err);
        setError('Failed to load inventory');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // ---------------------------------------------------------------------------
  // Add item
  // ---------------------------------------------------------------------------
  const addItem = useCallback(
    async ({
      name,
      quantity,
      unit,
      locationId,
      locationType,
      notes,
      shelfLifeDays,
      price,
      store,
    }) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      if (!name?.trim()) return { success: false, error: 'Name is required.' };
      if (!quantity || quantity <= 0)
        return { success: false, error: 'Quantity must be greater than 0.' };
      if (!locationId) return { success: false, error: 'Please select a storage location.' };
      if (!['fridge', 'freezer', 'pantry'].includes(locationType))
        return { success: false, error: 'Invalid location type.' };

      try {
        const chosenShelfLife = hasExplicitShelfLife(shelfLifeDays);
        const resolvedShelfLife = chosenShelfLife
          ? Number(shelfLifeDays)
          : resolveShelfLifeDays(name, locationType);
        const expiresAt = calcExpiresAt(locationType, resolvedShelfLife);
        const now = new Date();

        await addDoc(collection(db, 'users', user.uid, 'inventory'), {
          name: name.trim(),
          normalized: name.trim().toLowerCase(),
          quantity: Number(quantity),
          unit: unit || '',
          locationId,
          locationType,
          addedAt: serverTimestamp(),
          expiresAt,
          shelfLifeDays: resolvedShelfLife,
          shelfLifeSource: chosenShelfLife ? SHELF_LIFE_SOURCES.CUSTOM : SHELF_LIFE_SOURCES.DEFAULT,
          notes: notes || '',
          source: 'manual',
          purchaseHistory: [
            {
              addedAt: now,
              quantity: Number(quantity),
              unit: unit || '',
              price: price ? Number(price) : null,
              store: store || '',
            },
          ],
          totalTimesPurchased: 1,
        });

        return { success: true };
      } catch (err) {
        console.error('Error adding inventory item:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  // ---------------------------------------------------------------------------
  // Update item
  // ---------------------------------------------------------------------------
  const updateItem = useCallback(
    async (itemId, updates) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      try {
        const itemRef = doc(db, 'users', user.uid, 'inventory', itemId);
        const existing = items.find((i) => i.id === itemId);

        const patch = { ...updates, updatedAt: serverTimestamp() };

        // Anything that can change how long the item keeps: an explicit shelf
        // life, a move to another kind of storage, or a rename that lands on a
        // different ingredient in the shelf-life table.
        const chosenShelfLife = hasExplicitShelfLife(updates.shelfLifeDays);
        const movedLocation =
          Boolean(updates.locationType) && updates.locationType !== existing?.locationType;
        const renamed = Boolean(updates.name) && updates.name !== existing?.name;

        if (chosenShelfLife || movedLocation || renamed) {
          const nextLocationType = updates.locationType ?? existing?.locationType;
          const nextName = updates.name ?? existing?.name;
          let days;

          if (chosenShelfLife) {
            // The cook typed a number: that wins, and it is theirs from now on.
            days = Number(updates.shelfLifeDays);
            patch.shelfLifeDays = days;
            patch.shelfLifeSource = SHELF_LIFE_SOURCES.CUSTOM;
          } else if (isCustomShelfLife(existing)) {
            // They chose this shelf life earlier; moving the item does not
            // give us licence to overwrite it.
            days = Number(existing.shelfLifeDays);
          } else {
            // The stored shelf life was ours, so recalculate it for where the
            // item now lives — this is what makes freezing extend its life.
            days = resolveShelfLifeDays(nextName, nextLocationType);
            patch.shelfLifeDays = days;
            patch.shelfLifeSource = SHELF_LIFE_SOURCES.DEFAULT;
          }

          patch.expiresAt = calcExpiresAt(nextLocationType, days);
        }

        await updateDoc(itemRef, patch);
        return { success: true };
      } catch (err) {
        console.error('Error updating inventory item:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid, items]
  );

  // ---------------------------------------------------------------------------
  // Delete item
  // ---------------------------------------------------------------------------
  const deleteItem = useCallback(
    async (itemId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      try {
        await deleteDoc(doc(db, 'users', user.uid, 'inventory', itemId));
        return { success: true };
      } catch (err) {
        console.error('Error deleting inventory item:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const getItemById = useCallback((id) => items.find((i) => i.id === id) || null, [items]);

  const getItemsByLocation = useCallback(
    (locationId) => items.filter((i) => i.locationId === locationId),
    [items]
  );

  const getItemsByLocationType = useCallback(
    (type) => items.filter((i) => i.locationType === type),
    [items]
  );

  const getExpiringItems = useCallback(
    (withinDays = 5) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + withinDays);
      return items
        .filter((i) => {
          const exp = toDate(i.expiresAt);
          return exp !== null && exp <= cutoff;
        })
        .sort(byExpirySoonestFirst);
    },
    [items]
  );

  return {
    items,
    loading,
    error,
    addItem,
    updateItem,
    deleteItem,
    getItemById,
    getItemsByLocation,
    getItemsByLocationType,
    getExpiringItems,
  };
};

export default useInventory;
