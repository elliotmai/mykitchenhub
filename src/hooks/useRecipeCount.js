// src/hooks/useRecipeCount.js
// How many recipes exist, for the dashboard's "Recipes" stat.
//
// The `recipes` collection is global and owned by Phase 4. This hook only ever
// reads it, and treats "not there yet" as zero rather than as an error the user
// has to look at — a dashboard that breaks because the recipe library is empty
// is a broken dashboard.

import { useState, useEffect, useCallback } from 'react';
import { collection, getCountFromServer, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import { friendlyError } from '../utils/firebaseErrors';

/**
 * Count the recipes collection.
 *
 * Prefers the server-side aggregation so a 500-recipe library doesn't cost a
 * 500-document read on every dashboard visit, and falls back to counting a
 * plain query when the aggregation isn't available (older emulator builds).
 */
export const fetchRecipeCount = async () => {
  const ref = collection(db, 'recipes');

  if (typeof getCountFromServer === 'function') {
    try {
      const snapshot = await getCountFromServer(ref);
      const count = snapshot?.data?.()?.count;
      if (typeof count === 'number') return count;
    } catch {
      // Aggregation unsupported — fall through to the document count.
    }
  }

  const snapshot = await getDocs(ref);
  return snapshot?.size ?? 0;
};

/**
 * useRecipeCount Hook
 *
 * Usage:
 *   const { count, loading, error } = useRecipeCount();
 */
const useRecipeCount = () => {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    if (!user?.uid) {
      setCount(0);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const total = await fetchRecipeCount();
        if (cancelled) return;
        setCount(total);
        setError(null);
      } catch (err) {
        // Recipes may not be readable or populated yet. Show nothing, not a crash.
        console.error('Error counting recipes:', err);
        if (cancelled) return;
        setCount(0);
        setError(friendlyError(err, { action: 'load your recipes' }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, reloadKey]);

  return { count, loading, error, refresh };
};

export default useRecipeCount;
