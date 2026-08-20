// src/components/HelloFresh/EditDeliveryModal.jsx
// Correct a delivery already in the history.
//
// What it does not offer is as deliberate as what it does. The recipes and the
// counts are not editable: `mealCount` and `itemsAdded` describe what the
// import actually put in the kitchen, and letting them be typed over would
// leave the history disagreeing with the inventory it produced. `source` is
// pinned by the rules for the same reason — relabelling a delivery would take
// it out of the record the HelloFresh screen counts.
//
// So: when it came, which week it was, whether it has been cooked, and a note.

import { useEffect, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';

import { DELIVERY_STATUSES } from '../../hooks/useDeliveries';

/** A Firestore Timestamp, Date or ISO string as a `yyyy-mm-dd` field value. */
const toDateInput = (value) => {
  if (!value) return '';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const EditDeliveryModal = ({ show, onHide, onSave, delivery }) => {
  const [status, setStatus] = useState('received');
  const [deliveredAt, setDeliveredAt] = useState('');
  const [weekOf, setWeekOf] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!delivery) return;
    setStatus(delivery.status ?? 'received');
    setDeliveredAt(toDateInput(delivery.deliveredAt));
    setWeekOf(delivery.weekOf ?? '');
    setNotes(delivery.notes ?? '');
  }, [delivery]);

  if (!delivery) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const result = await onSave(delivery, {
      status,
      // Parsed back to a Date at noon so a timezone west of UTC cannot roll it
      // onto the previous day — the same trap the expiry dates hit.
      deliveredAt: deliveredAt ? new Date(`${deliveredAt}T12:00:00`) : undefined,
      weekOf,
      notes,
    });
    setSaving(false);
    if (result?.success) onHide();
  };

  return (
    <Modal show={show} onHide={onHide} centered scrollable>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 'var(--mkh-font-size-lg)' }}>Edit delivery</Modal.Title>
        </Modal.Header>

        <Modal.Body className="d-flex flex-column gap-3">
          <Form.Group controlId="edit-delivery-status">
            <Form.Label>Status</Form.Label>
            <Form.Select value={status} onChange={(event) => setStatus(event.target.value)}>
              {DELIVERY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group controlId="edit-delivery-date">
            <Form.Label>Arrived</Form.Label>
            <Form.Control
              type="date"
              value={deliveredAt}
              onChange={(event) => setDeliveredAt(event.target.value)}
            />
          </Form.Group>

          <Form.Group controlId="edit-delivery-week">
            <Form.Label>Week of</Form.Label>
            <Form.Control
              type="date"
              value={weekOf}
              onChange={(event) => setWeekOf(event.target.value)}
            />
          </Form.Group>

          <Form.Group controlId="edit-delivery-notes">
            <Form.Label>Notes</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Form.Group>

          <p className="text-muted mb-0" style={{ fontSize: 'var(--mkh-font-size-tiny)' }}>
            The meals and the item count come from the import itself and are not editable — they are
            what actually went into your kitchen.
          </p>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="link" className="text-muted" onClick={onHide} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : 'Save'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default EditDeliveryModal;
