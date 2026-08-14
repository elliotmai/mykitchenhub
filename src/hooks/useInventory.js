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

// ---------------------------------------------------------------------------
// Shelf life defaults (days) by location type
// ---------------------------------------------------------------------------
export const SHELF_LIFE_DEFAULTS = {
  freezer: 180,
  fridge: 7,
  pantry: 90,
};

// ---------------------------------------------------------------------------
// Helper: calculate expiresAt from locationType + addedAt
// ---------------------------------------------------------------------------
export const calcExpiresAt = (locationType, shelfLifeDays) => {
  const days = shelfLifeDays ?? SHELF_LIFE_DEFAULTS[locationType] ?? 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

// ---------------------------------------------------------------------------
// Helper: expiration status from expiresAt timestamp
// Returns: 'expired' | 'critical' | 'warning' | 'safe'
// ---------------------------------------------------------------------------
export const getExpirationStatus = (expiresAt) => {
  if (!expiresAt) return 'safe';
  const now = new Date();
  const exp = expiresAt?.toDate ? expiresAt.toDate() : new Date(expiresAt);
  const days = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

  if (days < 0) return 'expired';
  if (days <= 2) return 'critical';
  if (days <= 5) return 'warning';
  return 'safe';
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
        const resolvedShelfLife = shelfLifeDays ?? SHELF_LIFE_DEFAULTS[locationType] ?? 30;
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

        // Recalculate expiresAt if locationType or shelfLifeDays changed
        const patch = { ...updates, updatedAt: serverTimestamp() };
        if (updates.locationType || updates.shelfLifeDays) {
          const existing = items.find((i) => i.id === itemId);
          const lt = updates.locationType ?? existing?.locationType;
          const sld = updates.shelfLifeDays ?? existing?.shelfLifeDays;
          patch.expiresAt = calcExpiresAt(lt, sld);
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
      return items.filter((i) => {
        if (!i.expiresAt) return false;
        const exp = i.expiresAt?.toDate ? i.expiresAt.toDate() : new Date(i.expiresAt);
        return exp <= cutoff;
      });
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
