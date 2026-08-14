// src/components/StorageLocations/AddLocationModal.jsx
// Modal for creating or editing a storage location

import React, { useState, useEffect } from 'react';
import { Modal, Form, Button, Row, Col, Alert } from 'react-bootstrap';
import { MapPin } from 'lucide-react';

const LOCATION_TYPES = [
  { value: 'fridge', label: 'Fridge', icon: '🧊', defaultColor: '#3498db' },
  { value: 'freezer', label: 'Freezer', icon: '❄️', defaultColor: '#9b59b6' },
  { value: 'pantry', label: 'Pantry', icon: '🏺', defaultColor: '#e67e22' },
];

const ICON_OPTIONS = ['🧊', '❄️', '🏺', '🍞', '🚗', '📦', '🥩', '🧁', '🫙', '📍'];

const COLOR_OPTIONS = [
  '#3498db',
  '#9b59b6',
  '#e67e22',
  '#e74c3c',
  '#2ecc71',
  '#1abc9c',
  '#f39c12',
  '#34495e',
  '#e91e63',
  '#00bcd4',
];

/**
 * AddLocationModal
 *
 * @param {boolean}  show        - Whether the modal is visible
 * @param {function} onHide      - Callback to close the modal
 * @param {function} onSave      - Async callback({ label, type, icon, color }) => { success, error }
 * @param {object}   editLocation - If provided, pre-fills the form for editing
 */
const AddLocationModal = ({ show, onHide, onSave, editLocation = null }) => {
  const isEditing = Boolean(editLocation);

  const [label, setLabel] = useState('');
  const [type, setType] = useState('fridge');
  const [icon, setIcon] = useState('🧊');
  const [color, setColor] = useState('#3498db');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pre-fill when editing
  useEffect(() => {
    if (editLocation) {
      setLabel(editLocation.label || '');
      setType(editLocation.type || 'fridge');
      setIcon(editLocation.icon || '🧊');
      setColor(editLocation.color || '#3498db');
    } else {
      setLabel('');
      setType('fridge');
      setIcon('🧊');
      setColor('#3498db');
    }
    setError('');
  }, [editLocation, show]);

  // Auto-update icon/color when type changes (only for new locations)
  const handleTypeChange = (newType) => {
    setType(newType);
    if (!isEditing) {
      const typeConfig = LOCATION_TYPES.find((t) => t.value === newType);
      if (typeConfig) {
        setIcon(typeConfig.icon);
        setColor(typeConfig.defaultColor);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!label.trim()) {
      setError('Please enter a name for this location.');
      return;
    }

    setSaving(true);
    const result = await onSave({ label: label.trim(), type, icon, color });
    setSaving(false);

    if (result?.success) {
      onHide();
    } else {
      setError(result?.error || 'Something went wrong. Please try again.');
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="md">
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="d-flex align-items-center gap-2">
          <MapPin size={20} className="text-primary" />
          {isEditing ? 'Edit Location' : 'Add Storage Location'}
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
            <Form.Label className="fw-semibold">Name</Form.Label>
            <Form.Control
              type="text"
              placeholder='e.g. "Garage Freezer" or "Pantry Shelf"'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
              maxLength={40}
            />
          </Form.Group>

          {/* Type — disabled when editing to preserve data integrity */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Type</Form.Label>
            <div className="d-flex gap-2">
              {LOCATION_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  disabled={isEditing}
                  onClick={() => handleTypeChange(t.value)}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    borderRadius: '10px',
                    border: `2px solid ${type === t.value ? t.defaultColor : '#dee2e6'}`,
                    background: type === t.value ? `${t.defaultColor}18` : 'transparent',
                    cursor: isEditing ? 'not-allowed' : 'pointer',
                    opacity: isEditing ? 0.6 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: '1.5rem' }}>{t.icon}</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 4 }}>
                    {t.label}
                  </div>
                </button>
              ))}
            </div>
            {isEditing && (
              <Form.Text className="text-muted">
                Location type cannot be changed after creation.
              </Form.Text>
            )}
          </Form.Group>

          {/* Icon picker */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Icon</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {ICON_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setIcon(emoji)}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: '8px',
                    border: `2px solid ${icon === emoji ? '#0d6efd' : '#dee2e6'}`,
                    background: icon === emoji ? '#0d6efd18' : 'transparent',
                    fontSize: '1.25rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </Form.Group>

          {/* Color picker */}
          <Form.Group className="mb-1">
            <Form.Label className="fw-semibold">Color</Form.Label>
            <Row className="g-2">
              {COLOR_OPTIONS.map((hex) => (
                <Col key={hex} xs="auto">
                  <button
                    type="button"
                    onClick={() => setColor(hex)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: hex,
                      border: color === hex ? '3px solid #212529' : '3px solid transparent',
                      outline: color === hex ? `2px solid ${hex}` : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  />
                </Col>
              ))}
            </Row>
          </Form.Group>

          {/* Preview */}
          <div
            className="mt-4 p-3 rounded-3 d-flex align-items-center gap-3"
            style={{ background: `${color}18`, border: `1.5px solid ${color}55` }}
          >
            <div style={{ fontSize: '2rem' }}>{icon}</div>
            <div>
              <div style={{ fontWeight: 700, color }}>{label || 'Location Name'}</div>
              <div style={{ fontSize: '0.8rem', color: '#6c757d', textTransform: 'capitalize' }}>
                {type}
              </div>
            </div>
          </div>
        </Modal.Body>

        <Modal.Footer className="border-0 pt-0">
          <Button variant="light" onClick={onHide} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Location'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default AddLocationModal;
