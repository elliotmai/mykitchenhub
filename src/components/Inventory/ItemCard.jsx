// src/components/Inventory/ItemCard.jsx
// Displays a single inventory item with color-coded expiration status,
// quantity, location, and edit/delete controls.

import React from 'react';
import { Card, Badge, Button } from 'react-bootstrap';
import { Pencil, Trash2, Calendar, AlertTriangle } from 'lucide-react';
import {
  getExpirationLabel,
  getExpirationLevel,
  getExpirationBadgeStyle,
} from '../../hooks/useInventory';

const LOCATION_TYPE_ICONS = {
  fridge: '🧊',
  freezer: '❄️',
  pantry: '🏺',
};

/**
 * ItemCard
 *
 * @param {object}   item         - Inventory document from Firestore
 * @param {object}   location     - Matching storageLocation document (for label/icon)
 * @param {function} onEdit       - (item) => void — open edit modal
 * @param {function} onDelete     - (item) => void — open delete confirm
 */
const ItemCard = ({ item, location, onEdit, onDelete }) => {
  const level = getExpirationLevel(item.expiresAt);
  const badgeStyle = getExpirationBadgeStyle(item.expiresAt);
  const locationIcon = location?.icon ?? LOCATION_TYPE_ICONS[item.locationType] ?? '📦';
  const locationLabel = location?.label ?? item.locationType ?? 'Unknown';

  // Only the two levels a cook has to act on today get a written warning —
  // a warning on every card is a warning on none.
  const showWarning = level.status === 'expired' || level.status === 'critical';

  return (
    <Card
      className={`h-100 shadow-sm ${level.cardClass}`}
      style={{
        borderRadius: 'var(--mkh-radius-lg)',
        border: '1px solid var(--mkh-border)',
        transition: 'box-shadow var(--mkh-transition-fast)',
        cursor: 'default',
      }}
    >
      <Card.Body className="p-3 d-flex flex-column gap-2">
        {/* Top row: name + status badge */}
        <div className="d-flex justify-content-between align-items-start gap-2">
          <span
            className="fw-semibold text-truncate"
            style={{
              fontSize: 'var(--mkh-font-size-base)',
              color: 'var(--mkh-text-primary)',
              textTransform: 'capitalize',
            }}
            title={item.name}
          >
            {item.name}
          </span>
          <Badge
            style={{
              ...badgeStyle,
              borderRadius: 'var(--mkh-radius-full)',
              fontWeight: 'var(--mkh-font-weight-medium)',
              fontSize: 'var(--mkh-font-size-tiny)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {level.label}
          </Badge>
        </div>

        {/* Quantity row */}
        <div
          style={{
            fontSize: 'var(--mkh-font-size-small)',
            color: 'var(--mkh-text-secondary)',
          }}
        >
          <span
            className="fw-semibold"
            style={{ color: 'var(--mkh-text-primary)', fontSize: '1.1rem' }}
          >
            {item.quantity}
          </span>
          {item.unit && <span className="ms-1">{item.unit}</span>}
        </div>

        {/* Location row */}
        <div
          className="d-flex align-items-center gap-1"
          style={{ fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-secondary)' }}
        >
          <span>{locationIcon}</span>
          <span className="text-truncate">{locationLabel}</span>
        </div>

        {/* Expiration row */}
        <div
          className="d-flex align-items-center gap-1"
          style={{ fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-secondary)' }}
        >
          <Calendar size={12} />
          <span>{getExpirationLabel(item.expiresAt)}</span>
        </div>

        {/* Expiration warning — what to do about it, not just that it's red */}
        {showWarning && level.warning ? (
          <div
            className="d-flex align-items-start gap-1"
            data-testid="expiration-warning"
            style={{
              fontSize: 'var(--mkh-font-size-tiny)',
              color: level.foreground,
              fontWeight: 'var(--mkh-font-weight-medium)',
            }}
          >
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <span>{level.warning}</span>
          </div>
        ) : null}

        {/* Notes (if present) */}
        {item.notes ? (
          <div
            className="text-truncate"
            style={{
              fontSize: 'var(--mkh-font-size-tiny)',
              color: 'var(--mkh-text-muted)',
              fontStyle: 'italic',
            }}
            title={item.notes}
          >
            {item.notes}
          </div>
        ) : null}

        {/* Spacer */}
        <div className="flex-grow-1" />

        {/* Action buttons */}
        <div className="d-flex gap-2 mt-1">
          <Button
            size="sm"
            variant="light"
            className="flex-grow-1 d-flex align-items-center justify-content-center gap-1"
            style={{ fontSize: 'var(--mkh-font-size-tiny)', borderRadius: 'var(--mkh-radius-md)' }}
            onClick={() => onEdit?.(item)}
          >
            <Pencil size={12} />
            Edit
          </Button>
          <Button
            size="sm"
            variant="light"
            className="d-flex align-items-center justify-content-center"
            style={{
              fontSize: 'var(--mkh-font-size-tiny)',
              borderRadius: 'var(--mkh-radius-md)',
              color: 'var(--mkh-danger-text)',
            }}
            onClick={() => onDelete?.(item)}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ItemCard;
