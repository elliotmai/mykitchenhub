// src/dishes/DishPicker.jsx
// A meal planned as a dish ("Lasagna") rather than one recipe: choose which
// recipe when it's time to cook. Choosing writes the recipe onto the meal,
// with its ingredients, so the shopping list and cooking use that one.

import React, { useEffect, useState } from 'react';
import { Form } from 'react-bootstrap';

import { collection, doc, getDocs, updateDoc } from '../backend/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../hooks/useAuth';
import { recipeIngredients } from '../components/MealPlan/ScheduleMealModal';
import { groupDishes } from './dishLogic';

const DishPicker = ({ entry }) => {
  const { user } = useAuth();
  const [dish, setDish] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!entry?.dishId) return undefined;
    let live = true;
    Promise.all([getDocs(collection(db, 'recipes')), getDocs(collection(db, 'dishes'))])
      .then(([recipes, dishes]) => {
        if (!live) return;
        const grouped = groupDishes(
          recipes.docs.map((d) => ({ id: d.id, ...d.data() })),
          Object.fromEntries(dishes.docs.map((d) => [d.id, d.data()]))
        );
        setDish(grouped.find((d) => d.id === entry.dishId) || null);
      })
      .catch(() => live && setDish(null));
    return () => {
      live = false;
    };
  }, [entry?.dishId]);

  if (!entry?.dishId || entry.recipeId || !dish || !user?.uid) return null;

  const choose = async (recipeId) => {
    const recipe = dish.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid, 'mealPlanEntries', entry.id), {
        recipeId: recipe.id,
        recipeName: recipe.name,
        usesIngredients: recipeIngredients(recipe),
      });
    } catch (err) {
      console.error('Error choosing a recipe:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Form.Select
      size="sm"
      className="mt-1"
      disabled={saving}
      aria-label={`Which ${dish.name} recipe?`}
      value=""
      onChange={(e) => choose(e.target.value)}
    >
      <option value="">Which {dish.name}?</option>
      {dish.recipes.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
          {r.id === dish.favoriteId ? ' (favourite)' : ''}
        </option>
      ))}
    </Form.Select>
  );
};

export default DishPicker;
