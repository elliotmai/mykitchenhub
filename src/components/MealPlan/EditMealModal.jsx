// src/components/MealPlan/EditMealModal.jsx
// Amend a meal already on the board.
//
// Separate from ScheduleMealModal on purpose. That one answers "what are we
// eating on Thursday" — it picks a day and a recipe. This one answers "that is
// right, but it feeds four" and deliberately cannot change the recipe or the
// day: swapping the recipe is a different meal, and the board already moves a
// meal between days with the picker on its own card.
//
// The fields are exactly what `updateMeal` will write, which is exactly what
// the rules allow to change on a mealPlanEntry.

import { useEffect, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';

import { MEAL_TYPES } from '../../hooks/useMealPlan';

const EditMealModal = ({ show, onHide, onSave, entry }) => {
  const [recipeName, setRecipeName] = useState('');
  const [servings, setServings] = useState('');
  const [mealType, setMealType] = useState('dinner');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seeded whenever a different meal is opened. Without the dependency on
  // the entry, opening a second card would show the first one's numbers.
  useEffect(() => {
    if (!entry) return;
    setRecipeName(entry.recipeName ?? '');
    setServings(String(entry.servings ?? ''));
    setMealType(entry.mealType ?? 'dinner');
    setNotes(entry.notes ?? '');
  }, [entry]);

  if (!entry) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (!recipeName.trim() || saving) return;
    setSaving(true);
    const result = await onSave(entry, { recipeName, servings, mealType, notes });
    setSaving(false);
    // Left open on a refusal so the edit is still there to correct; the toast
    // says what was wrong with it.
    if (result?.success) onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered scrollable>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 'var(--mkh-font-size-lg)' }}>Edit meal</Modal.Title>
        </Modal.Header>

        <Modal.Body className="d-flex flex-column gap-3">
          <Form.Group controlId="edit-meal-name">
            <Form.Label>Meal</Form.Label>
            <Form.Control
              value={recipeName}
              onChange={(event) => setRecipeName(event.target.value)}
              autoFocus
            />
          </Form.Group>

          <Form.Group controlId="edit-meal-servings">
            <Form.Label>Servings</Form.Label>
            <Form.Control
              type="number"
              min="1"
              step="any"
              value={servings}
              onChange={(event) => setServings(event.target.value)}
            />
          </Form.Group>

          <Form.Group controlId="edit-meal-type">
            <Form.Label>Sitting</Form.Label>
            <Form.Select value={mealType} onChange={(event) => setMealType(event.target.value)}>
              {MEAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group controlId="edit-meal-notes">
            <Form.Label>Notes</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Double the sauce, use the big dish…"
            />
          </Form.Group>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="link" className="text-muted" onClick={onHide} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!recipeName.trim() || saving}>
            {saving ? <Spinner animation="border" size="sm" /> : 'Save'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default EditMealModal;
