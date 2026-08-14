// src/components/Inventory/AddItemModal.jsx
// Modal for adding or editing an inventory item.
// Validates input and calculates expiresAt from locationType + shelfLifeDays.

import React, { useState, useEffect } from 'react';
import { Modal, Form, Button, Row, Col, Alert } from 'react-bootstrap';
import { Package } from 'lucide-react';
import { SHELF_LIFE_DEFAULTS } from '../../hooks/useInventory';

const UNIT_OPTIONS = [
  '',
  'lbs',
  'oz',
  'kg',
  'g',
  'cups',
  'fl oz',
  'L',
  'ml',
  'pieces',
  'slices',
  'cans',
  'bags',
  'boxes',
  'jars',
];

const EMPTY_FORM = {
  name: '',
  quantity: '',
  unit: '',
  locationId: '',
  locationType: '',
  shelfLifeDays: '',
  notes: '',
  price: '',
  store: '',
};

/**
 * AddItemModal
 *
 * @param {boolean}  show          - Controls visibility
 * @param {function} onHide        - Close callback
 * @param {function} onSave        - async (data) => { success, error }
 * @param {array}    locations     - Array of storageLocation objects from useStorageLocations
 * @param {object}   editItem      - If provided, pre-fills form for editing
 */
const AddItemModal = ({ show, onHide, onSave, locations = [], editItem = null }) => {
  const isEditing = Boolean(editItem);

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pre-fill when editing or reset on open
  useEffect(() => {
    if (!show) return;

    if (editItem) {
      setForm({
        name: editItem.name ?? '',
        quantity: editItem.quantity ?? '',
        unit: editItem.unit ?? '',
        locationId: editItem.locationId ?? '',
        locationType: editItem.locationType ?? '',
        shelfLifeDays: editItem.shelfLifeDays ?? '',
        notes: editItem.notes ?? '',
        price: '',
        store: '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError('');
  }, [show, editItem]);

  // When the selected location changes, update locationType + default shelfLifeDays
  const handleLocationChange = (locationId) => {
    const loc = locations.find((l) => l.id === locationId);
    const lt = loc?.type ?? '';
    setForm((prev) => ({
      ...prev,
      locationId: locationId,
      locationType: lt,
      // Only set default shelfLifeDays if user hasn't typed a custom value
      shelfLifeDays:
        prev.shelfLifeDays === '' ||
        prev.shelfLifeDays === String(SHELF_LIFE_DEFAULTS[prev.locationType])
          ? String(SHELF_LIFE_DEFAULTS[lt] ?? '')
          : prev.shelfLifeDays,
    }));
  };

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!form.name.trim()) {
      setError('Item name is required.');
      return;
    }
    const qty = parseFloat(form.quantity);
    if (!form.quantity || isNaN(qty) || qty <= 0) {
      setError('Quantity must be a number greater than 0.');
      return;
    }
    if (!form.locationId) {
      setError('Please select a storage location.');
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      quantity: qty,
      unit: form.unit,
      locationId: form.locationId,
      locationType: form.locationType,
      shelfLifeDays: form.shelfLifeDays ? parseInt(form.shelfLifeDays, 10) : undefined,
      notes: form.notes.trim(),
      price: form.price ? parseFloat(form.price) : null,
      store: form.store.trim(),
    };

    const result = await onSave(payload);
    setSaving(false);

    if (result?.success) {
      onHide();
    } else {
      setError(result?.error || 'Something went wrong. Please try again.');
    }
  };

  // Computed shelf-life preview label
  const previewDays = form.shelfLifeDays
    ? parseInt(form.shelfLifeDays, 10)
    : (SHELF_LIFE_DEFAULTS[form.locationType] ?? null);

  const previewDate = previewDays
    ? (() => {
        const d = new Date();
        d.setDate(d.getDate() + previewDays);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      })()
    : null;

  return (
    <Modal show={show} onHide={onHide} centered size="md">
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="d-flex align-items-center gap-2">
          <Package size={20} className="text-primary" />
          {isEditing ? 'Edit Item' : 'Add Inventory Item'}
        </Modal.Title>
      </Modal.Header>

      <Form onSubmit={handleSubmit}>
        <Modal.Body className="pt-3">
          {error && (
            <Alert variant="danger" className="py-2">
              {error}
            </Alert>
          )}

          {/* Name */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">
              Item Name <span className="text-danger">*</span>
            </Form.Label>
            <Form.Control
              type="text"
              placeholder='e.g. "Chicken Breast" or "Whole Milk"'
              value={form.name}
              onChange={handleChange('name')}
              autoFocus
              maxLength={80}
            />
          </Form.Group>

          {/* Quantity + Unit */}
          <Row className="mb-3">
            <Col xs={5}>
              <Form.Group>
                <Form.Label className="fw-semibold">
                  Quantity <span className="text-danger">*</span>
                </Form.Label>
                <Form.Control
                  type="number"
                  placeholder="e.g. 2"
                  value={form.quantity}
                  onChange={handleChange('quantity')}
                  min="0.01"
                  step="0.01"
                />
              </Form.Group>
            </Col>
            <Col xs={7}>
              <Form.Group>
                <Form.Label className="fw-semibold">Unit</Form.Label>
                <Form.Select value={form.unit} onChange={handleChange('unit')}>
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u || '— none —'}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          {/* Storage Location */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">
              Storage Location <span className="text-danger">*</span>
            </Form.Label>
            {locations.length === 0 ? (
              <Alert variant="warning" className="py-2 mb-0">
                No storage locations found. Add one in Settings first.
              </Alert>
            ) : (
              <Form.Select
                value={form.locationId}
                onChange={(e) => handleLocationChange(e.target.value)}
              >
                <option value="">Select a location…</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.icon ? `${loc.icon} ` : ''}
                    {loc.label} ({loc.type})
                  </option>
                ))}
              </Form.Select>
            )}
          </Form.Group>

          {/* Shelf Life Override */}
          <Form.Group className="mb-1">
            <Form.Label className="fw-semibold">Shelf Life (days)</Form.Label>
            <Form.Control
              type="number"
              placeholder={
                form.locationType
                  ? `Default: ${SHELF_LIFE_DEFAULTS[form.locationType] ?? 30}`
                  : 'Select a location first'
              }
              value={form.shelfLifeDays}
              onChange={handleChange('shelfLifeDays')}
              min="1"
              disabled={!form.locationType}
            />
            {previewDate && (
              <Form.Text className="text-muted">
                📅 Estimated expiry: <strong>{previewDate}</strong>
              </Form.Text>
            )}
          </Form.Group>

          <hr style={{ borderColor: 'var(--mkh-border-light)' }} />

          {/* Notes */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Notes</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              placeholder='e.g. "Organic, from Costco"'
              value={form.notes}
              onChange={handleChange('notes')}
              maxLength={200}
            />
          </Form.Group>

          {/* Price + Store (optional, for purchase history) */}
          {!isEditing && (
            <Row className="mb-1">
              <Col xs={5}>
                <Form.Group>
                  <Form.Label className="fw-semibold">Price ($)</Form.Label>
                  <Form.Control
                    type="number"
                    placeholder="e.g. 8.99"
                    value={form.price}
                    onChange={handleChange('price')}
                    min="0"
                    step="0.01"
                  />
                </Form.Group>
              </Col>
              <Col xs={7}>
                <Form.Group>
                  <Form.Label className="fw-semibold">Store</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder='e.g. "Costco"'
                    value={form.store}
                    onChange={handleChange('store')}
                    maxLength={50}
                  />
                </Form.Group>
              </Col>
            </Row>
          )}
        </Modal.Body>

        <Modal.Footer className="border-0 pt-0">
          <Button variant="light" onClick={onHide} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving || locations.length === 0}>
            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Item'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default AddItemModal;
