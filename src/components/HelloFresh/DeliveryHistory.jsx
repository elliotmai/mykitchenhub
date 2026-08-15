// src/components/HelloFresh/DeliveryHistory.jsx
// Every box you've logged, newest first.

import React from 'react';
import { Badge, Button, Card, Col, Row } from 'react-bootstrap';
import { CalendarDays, Package, Trash2, Utensils } from 'lucide-react';

import { CardLoader } from '../Common';

const STATUS_VARIANTS = {
  scheduled: 'secondary',
  received: 'success',
  cooked: 'primary',
};

/** Firestore hands back a Timestamp; a fresh local write hands back a Date. */
export const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return 'Date unknown';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const DeliveryHistory = ({ deliveries = [], loading = false, onDelete }) => {
  if (loading) return <CardLoader />;

  if (deliveries.length === 0) {
    return (
      <Card>
        <Card.Body className="text-center py-5">
          <Package size={48} className="text-muted mb-3 opacity-50" aria-hidden="true" />
          <h5>No deliveries yet</h5>
          <p className="text-muted mb-0">
            When your next box turns up, log it here and everything in it goes straight into your
            kitchen.
          </p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <div className="delivery-history">
      {deliveries.map((delivery) => (
        <Card key={delivery.id} className="mb-3">
          <Card.Body>
            <Row className="align-items-start g-2">
              <Col>
                <div className="d-flex align-items-center gap-2 mb-2">
                  <CalendarDays size={18} className="text-muted" aria-hidden="true" />
                  <span className="fw-semibold">{formatDate(delivery.deliveredAt)}</span>
                  <Badge bg={STATUS_VARIANTS[delivery.status] ?? 'secondary'}>
                    {delivery.status ?? 'received'}
                  </Badge>
                </div>

                <div className="d-flex flex-wrap gap-3 text-muted small mb-2">
                  <span className="d-flex align-items-center gap-1">
                    <Utensils size={14} aria-hidden="true" />
                    {delivery.mealCount ?? 0} meal{delivery.mealCount === 1 ? '' : 's'}
                  </span>
                  <span className="d-flex align-items-center gap-1">
                    <Package size={14} aria-hidden="true" />
                    {delivery.itemsAdded ?? 0} ingredient
                    {delivery.itemsAdded === 1 ? '' : 's'} added
                  </span>
                </div>

                {(delivery.recipeNames ?? []).length > 0 && (
                  <div className="d-flex flex-wrap gap-1">
                    {delivery.recipeNames.map((name) => (
                      <Badge key={name} bg="light" text="dark">
                        {name}
                      </Badge>
                    ))}
                  </div>
                )}

                {delivery.notes && <p className="text-muted small mt-2 mb-0">{delivery.notes}</p>}
              </Col>

              {onDelete && (
                <Col xs="auto">
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => onDelete(delivery)}
                    aria-label={`Remove delivery from ${formatDate(delivery.deliveredAt)}`}
                  >
                    <Trash2 size={16} />
                  </Button>
                </Col>
              )}
            </Row>
          </Card.Body>
        </Card>
      ))}
    </div>
  );
};

export default DeliveryHistory;
