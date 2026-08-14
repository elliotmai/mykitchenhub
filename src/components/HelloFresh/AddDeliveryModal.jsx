// src/components/HelloFresh/AddDeliveryModal.jsx
// "My box arrived" — tick the meals that came, and everything in them lands in
// the fridge with expiry dates and gets scheduled to cook.

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { PackageCheck } from 'lucide-react';

import { addDays, cookDayOffset, mergeIngredients, toDateKey } from '../../hooks/useDeliveries';

const formatCookDay = (deliveredAt, index) =>
  addDays(deliveredAt, cookDayOffset(index)).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

const AddDeliveryModal = ({
  show,
  onHide,
  onSubmit,
  recipes = [],
  recipesLoading = false,
  locations = [],
  saving = false,
}) => {
  const [selectedIds, setSelectedIds] = useState([]);
  const [deliveredOn, setDeliveredOn] = useState(() => toDateKey(new Date()));
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  // Ingredients keep best in a fridge, which is where a HelloFresh box goes.
  const storageOptions = useMemo(
    () => locations.filter((location) => ['fridge', 'freezer', 'pantry'].includes(location.type)),
    [locations]
  );

  const defaultLocationId = useMemo(() => {
    const fridge = storageOptions.find((location) => location.type === 'fridge');
    return fridge?.id ?? storageOptions[0]?.id ?? '';
  }, [storageOptions]);

  // Reset to a clean sheet each time the modal opens.
  useEffect(() => {
    if (!show) return;
    setSelectedIds([]);
    setDeliveredOn(toDateKey(new Date()));
    setLocationId(defaultLocationId);
    setNotes('');
    setError('');
  }, [show, defaultLocationId]);

  const selectedRecipes = useMemo(
    () => selectedIds.map((id) => recipes.find((recipe) => recipe.id === id)).filter(Boolean),
    [recipes, selectedIds]
  );

  const ingredientCount = useMemo(
    () => mergeIngredients(selectedRecipes).length,
    [selectedRecipes]
  );

  const deliveryDate = useMemo(() => {
    // A bare YYYY-MM-DD parses as UTC midnight, which is the previous day west
    // of Greenwich. Build it in local time instead.
    const [year, month, day] = deliveredOn.split('-').map(Number);
    return new Date(year, (month ?? 1) - 1, day ?? 1);
  }, [deliveredOn]);

  const toggle = (id) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (selectedRecipes.length === 0) {
      setError('Pick at least one meal that came in the box.');
      return;
    }

    const location = storageOptions.find((option) => option.id === locationId);
    if (!location) {
      setError('Choose where the ingredients should go.');
      return;
    }

    const result = await onSubmit({
      recipes: selectedRecipes,
      deliveredAt: deliveryDate,
      location,
      notes,
    });

    if (result?.success) onHide();
    else setError(result?.error ?? 'That delivery could not be saved. Please try again.');
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered scrollable>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title className="d-flex align-items-center gap-2">
            <PackageCheck size={22} /> Add a delivery
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}

          <Form.Group className="mb-3" controlId="delivery-date">
            <Form.Label>When did it arrive?</Form.Label>
            <Form.Control
              type="date"
              value={deliveredOn}
              onChange={(event) => setDeliveredOn(event.target.value)}
            />
          </Form.Group>

          <Form.Group className="mb-4" controlId="delivery-location">
            <Form.Label>Where are you putting the ingredients?</Form.Label>
            <Form.Select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              disabled={storageOptions.length === 0}
            >
              {storageOptions.length === 0 && <option value="">No storage locations yet</option>}
              {storageOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.icon ? `${location.icon} ` : ''}
                  {location.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <h6>Which meals came in the box?</h6>

          {recipesLoading && (
            <div className="text-center py-3">
              <Spinner animation="border" role="status" aria-label="Loading recipes" />
            </div>
          )}

          {!recipesLoading && recipes.length === 0 && (
            <Alert variant="info">
              Import a recipe first — photograph a card or paste a link — and it will show up here.
            </Alert>
          )}

          {!recipesLoading &&
            recipes.map((recipe) => (
              <Form.Check
                key={recipe.id}
                type="checkbox"
                id={`delivery-recipe-${recipe.id}`}
                className="mb-2"
                checked={selectedIds.includes(recipe.id)}
                onChange={() => toggle(recipe.id)}
                label={
                  <span>
                    {recipe.name}{' '}
                    <Badge bg="light" text="dark">
                      {recipe.ingredients?.length ?? 0} ingredients
                    </Badge>
                  </span>
                }
              />
            ))}

          {selectedRecipes.length > 0 && (
            <Alert variant="success" className="mt-3 mb-0">
              <div className="fw-semibold">Here&rsquo;s what will happen:</div>
              <ul className="mb-0 mt-1">
                <li>
                  {ingredientCount} ingredient{ingredientCount === 1 ? '' : 's'} added to{' '}
                  {storageOptions.find((option) => option.id === locationId)?.label ??
                    'your kitchen'}
                  , each with its own use-by date.
                </li>
                <li>
                  Meals scheduled for{' '}
                  {selectedRecipes
                    .map(
                      (recipe, index) => `${recipe.name} on ${formatCookDay(deliveryDate, index)}`
                    )
                    .join(', ')}
                  .
                </li>
              </ul>
            </Alert>
          )}

          <Form.Group className="mt-3" controlId="delivery-notes">
            <Form.Label>Notes (optional)</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Box was missing the lime…"
            />
          </Form.Group>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onHide} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving}
            className="d-flex align-items-center gap-2"
          >
            {saving ? (
              <>
                <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
                Adding…
              </>
            ) : (
              'Add delivery'
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default AddDeliveryModal;
