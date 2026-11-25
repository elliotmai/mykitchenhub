// src/dishes/useDishes.js
// The household's dishes: its recipes grouped by what they make
// (./dishLogic.js), plus what someone decided about them, kept in
// kitchen.docs 'dishes/<id>' (a name, a favourite recipe, a merge). Moving a
// recipe stores its dish on the recipe itself (`dishId`).

import { useCallback, useEffect, useMemo, useState } from 'react';

import { collection, doc, onSnapshot, setDoc, updateDoc } from '../backend/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../hooks/useAuth';
import { friendlyError } from '../utils/firebaseErrors';
import { groupDishes, newDishId } from './dishLogic';

const useDishes = (recipes = []) => {
  const { user } = useAuth();
  const [docs, setDocs] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setDocs({});
      return undefined;
    }
    return onSnapshot(
      collection(db, 'dishes'),
      (snapshot) => {
        setDocs(Object.fromEntries(snapshot.docs.map((d) => [d.id, d.data()])));
        setError(null);
      },
      (err) => setError(friendlyError(err, { action: 'load your dishes' }))
    );
  }, [user?.uid]);

  const dishes = useMemo(() => groupDishes(recipes, docs), [recipes, docs]);
  /** Group some recipes (a filtered list) the same way. */
  const group = useCallback((list) => groupDishes(list, docs), [docs]);

  const run = useCallback(async (action, work) => {
    try {
      await work();
      return { success: true };
    } catch (err) {
      console.error(`Error trying to ${action}:`, err);
      return { success: false, error: friendlyError(err, { action }) };
    }
  }, []);

  const renameDish = useCallback(
    (dishId, name) => {
      const clean = String(name ?? '').trim();
      if (!clean) return Promise.resolve({ success: false, error: 'Give the dish a name.' });
      return run('rename that dish', () =>
        setDoc(doc(db, 'dishes', dishId), { name: clean.slice(0, 120) }, { merge: true })
      );
    },
    [run]
  );

  const setFavorite = useCallback(
    (dishId, recipeId) =>
      run('choose the favourite', () =>
        setDoc(doc(db, 'dishes', dishId), { favoriteRecipeId: recipeId || null }, { merge: true })
      ),
    [run]
  );

  const moveRecipe = useCallback(
    (recipeId, dishId) =>
      run('move that recipe', () => updateDoc(doc(db, 'recipes', recipeId), { dishId })),
    [run]
  );

  /** Start a new dish with this name, and put the recipe in it. */
  const moveToNewDish = useCallback(
    async (recipeId, name) => {
      const clean = String(name ?? '').trim();
      if (!clean) return { success: false, error: 'Give the new dish a name.' };
      const id = newDishId(clean, [...dishes.map((d) => d.id), ...Object.keys(docs)]);
      return run('make that dish', async () => {
        await setDoc(doc(db, 'dishes', id), { name: clean.slice(0, 120) }, { merge: true });
        await updateDoc(doc(db, 'recipes', recipeId), { dishId: id });
      });
    },
    [dishes, docs, run]
  );

  /** Everything in `fromId` joins `intoId`, now and for recipes that would have gone there later. */
  const mergeDish = useCallback(
    (fromId, intoId) => {
      if (!intoId || fromId === intoId) return Promise.resolve({ success: true, unchanged: true });
      const from = dishes.find((d) => d.id === fromId);
      return run('merge those dishes', async () => {
        for (const recipe of from?.recipes || []) {
          await updateDoc(doc(db, 'recipes', recipe.id), { dishId: intoId });
        }
        await setDoc(doc(db, 'dishes', fromId), { mergedInto: intoId }, { merge: true });
      });
    },
    [dishes, run]
  );

  return { dishes, group, error, renameDish, setFavorite, moveRecipe, moveToNewDish, mergeDish };
};

export default useDishes;
