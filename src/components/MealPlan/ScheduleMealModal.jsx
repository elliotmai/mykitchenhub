// src/components/MealPlan/ScheduleMealModal.jsx
// Pick a recipe and put it on a day — roadmap 7.1.
//
// Reads the shared `recipes` collection per the contract in
// firestore/firestore.rules. Recipe *browsing* is Phase 4's; this is a picker.

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { MEAL_TYPES } from '../../hooks/useMealPlan';

/** Recipes are written with `name`; older legacy imports use `title`. Accept both. */
export const recipeLabel = (recipe) => recipe?.name || recipe?.title || 'Untitled recipe';

/** Alphabetical by the label the cook actually reads. */
export const sortByLabel = (recipes) =>
  [...recipes].sort((a, b) => recipeLabel(a).localeCompare(recipeLabel(b)));

/** The ingredient shape a meal plan entry stores, from a recipe document. */
export const recipeIngredients = (recipe) =>
  (recipe?.ingredients || []).map((ingredient) => ({
    name: ingredient.name ?? '',
    normalized: (ingredient.normalized ?? ingredient.name ?? '').toString().trim().toLowerCase(),
    quantity: Number(ingredient.quantity) || 0,
    unit: ingredient.unit ?? '',
  }));

const ScheduleMealModal = ({ show, onHide, onSave, date, days = [] }) => {
  const [recipes, setRecipes] = useState([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [recipeId, setRecipeId] = useState('');
  const [customName, setCustomName] = useState('');
  const [mealType, setMealType] = useState('dinner');
  const [servings, setServings] = useState(2);
  const [day, setDay] = useState(date || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!show) return;
    setDay(date || '');
    setError('');
    setRecipeId('');
    setCustomName('');
    setMealType('dinner');
    setServings(2);
  }, [show, date]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;

    const load = async () => {
      setLoadingRecipes(true);
      try {
        // Deliberately no orderBy('name'): Firestore drops documents that are
        // missing the field entirely, so ordering server-side would hide every
        // legacy recipe that only carries `title` — the very ones recipeLabel
        // exists to handle. Sorting a bounded page here costs nothing.
        const snapshot = await getDocs(query(collection(db, 'recipes'), limit(100)));
        if (!cancelled) {
          setRecipes(sortByLabel(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))));
        }
      } catch (err) {
        console.error('Error loading recipes:', err);
        if (!cancelled) setRecipes([]);
      } finally {
        if (!cancelled) setLoadingRecipes(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [show]);

  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === recipeId) || null,
    [recipes, recipeId]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const name = selectedRecipe ? recipeLabel(selectedRecipe) : customName.trim();
    if (!name) {
      setError('Choose a recipe, or type what you are cooking.');
      return;
    }

    setSaving(true);
    const result = await onSave({
      date: day,
      mealType,
      servings: Number(servings),
      recipeId: selectedRecipe?.id ?? null,
      recipeName: name,
      usesIngredients: selectedRecipe ? recipeIngredients(selectedRecipe) : [],
    });
    setSaving(false);

    if (result?.success) onHide();
    else setError(result?.error || 'Could not add that meal. Please try again.');
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 'var(--mkh-font-size-large, 1.15rem)' }}>
            Add a meal
          </Modal.Title>
        </Modal.Header>

        <Modal.Body className="d-flex flex-column gap-3">
          {error && <Alert variant="danger">{error}</Alert>}

          <Form.Group controlId="meal-day">
            <Form.Label>Day</Form.Label>
            <Form.Select value={day} onChange={(event) => setDay(event.target.value)}>
              {days.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label} {option.monthLabel} {option.dayOfMonth}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group controlId="meal-recipe">
            <Form.Label>Recipe</Form.Label>
            {loadingRecipes ? (
              <div className="d-flex align-items-center gap-2 text-muted">
                <Spinner animation="border" size="sm" /> Loading your recipes…
              </div>
            ) : (
              <Form.Select value={recipeId} onChange={(event) => setRecipeId(event.target.value)}>
                <option value="">Something else…</option>
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipeLabel(recipe)}
                  </option>
                ))}
              </Form.Select>
            )}
          </Form.Group>

          {!recipeId && (
            <Form.Group controlId="meal-custom-name">
              <Form.Label>What are you cooking?</Form.Label>
              <Form.Control
                type="text"
                placeholder="Leftovers, takeout, pasta…"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
              />
            </Form.Group>
          )}

          <div className="d-flex gap-3">
            <Form.Group controlId="meal-type" className="flex-grow-1">
              <Form.Label>Meal</Form.Label>
              <Form.Select value={mealType} onChange={(event) => setMealType(event.target.value)}>
                {MEAL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type[0].toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group controlId="meal-servings" style={{ width: '8rem' }}>
              <Form.Label>Servings</Form.Label>
              <Form.Control
                type="number"
                min="1"
                value={servings}
                onChange={(event) => setServings(event.target.value)}
              />
            </Form.Group>
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="light" onClick={onHide} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Adding…' : 'Add to plan'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default ScheduleMealModal;
