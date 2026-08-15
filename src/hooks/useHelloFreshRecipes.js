// src/hooks/useHelloFreshRecipes.js
// The HelloFresh recipes already imported, for the Add Delivery picker.
//
// Deliberately narrow: this exists so the delivery workflow can offer "which of
// these came in the box?", not to browse or render recipes. Recipe browsing is
// roadmap phase 4 and lives in its own components.

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../services/firebase';
import { useAuth } from './useAuth';

/** A box is a handful of meals; nobody picks from hundreds. */
export const RECIPE_LIMIT = 50;

const useHelloFreshRecipes = () => {
  const { user } = useAuth();
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // The recipes rules require an authenticated reader.
    if (!user?.uid) {
      setRecipes([]);
      setLoading(false);
      return undefined;
    }

    const q = query(
      collection(db, 'recipes'),
      where('source', '==', 'hellofresh'),
      orderBy('createdAt', 'desc'),
      limit(RECIPE_LIMIT)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setRecipes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching HelloFresh recipes:', err);
        setError('Failed to load your imported recipes');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  return { recipes, loading, error };
};

export default useHelloFreshRecipes;
