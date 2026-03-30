// src/hooks/useStorageLocations.js
// Custom hook for real-time storage location management
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
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './useAuth';

/**
 * useStorageLocations Hook
 *
 * Manages storage locations with real-time Firestore updates.
 *
 * Usage:
 * const {
 *   locations, loading, error,
 *   createLocation, updateLocation, deleteLocation
 * } = useStorageLocations();
 */
const useStorageLocations = () => {
  const { user } = useAuth();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ---------------------------------------------------------------------------
  // Real-time listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user?.uid) {
      setLocations([]);
      setLoading(false);
      return;
    }

    const locationsRef = collection(db, 'users', user.uid, 'storageLocations');
    const q = query(locationsRef, orderBy('order', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const locs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLocations(locs);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching storage locations:', err);
        setError('Failed to load storage locations');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  const createLocation = useCallback(
    async ({ label, type, icon, color }) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      try {
        const locationsRef = collection(db, 'users', user.uid, 'storageLocations');
        const maxOrder = locations.reduce((max, l) => Math.max(max, l.order ?? 0), -1);

        await addDoc(locationsRef, {
          label,
          type,
          icon,
          color,
          order: maxOrder + 1,
          isDefault: false,
          itemCount: 0,
          createdAt: serverTimestamp(),
        });

        return { success: true };
      } catch (err) {
        console.error('Error creating storage location:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid, locations]
  );

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const updateLocation = useCallback(
    async (locationId, updates) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      try {
        const locationRef = doc(db, 'users', user.uid, 'storageLocations', locationId);
        await updateDoc(locationRef, {
          ...updates,
          updatedAt: serverTimestamp(),
        });
        return { success: true };
      } catch (err) {
        console.error('Error updating storage location:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid]
  );

  // ---------------------------------------------------------------------------
  // Delete — with safety check for items
  // ---------------------------------------------------------------------------
  const deleteLocation = useCallback(
    async (locationId) => {
      if (!user?.uid) return { success: false, error: 'Not authenticated' };

      const location = locations.find((l) => l.id === locationId);

      if (location?.isDefault) {
        return { success: false, error: 'Cannot delete a default location.' };
      }

      try {
        // Check if any inventory items reference this location
        const inventoryRef = collection(db, 'users', user.uid, 'inventory');
        const inventorySnap = await getDocs(inventoryRef);
        const itemsInLocation = inventorySnap.docs.filter(
          (d) => d.data().locationId === locationId
        );

        if (itemsInLocation.length > 0) {
          return {
            success: false,
            error: `This location has ${itemsInLocation.length} item(s). Move them first before deleting.`,
            itemCount: itemsInLocation.length,
          };
        }

        await deleteDoc(doc(db, 'users', user.uid, 'storageLocations', locationId));
        return { success: true };
      } catch (err) {
        console.error('Error deleting storage location:', err);
        return { success: false, error: err.message };
      }
    },
    [user?.uid, locations]
  );

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const getLocationById = useCallback(
    (id) => locations.find((l) => l.id === id) || null,
    [locations]
  );

  const getLocationsByType = useCallback(
    (type) => locations.filter((l) => l.type === type),
    [locations]
  );

  return {
    locations,
    loading,
    error,
    createLocation,
    updateLocation,
    deleteLocation,
    getLocationById,
    getLocationsByType,
  };
};

export default useStorageLocations;
