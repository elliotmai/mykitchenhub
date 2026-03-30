// src/components/Inventory/ItemCard.jsx
// Displays a single inventory item with color-coded expiration status,
// quantity, location, and edit/delete controls.

import React from 'react';
import { Card, Badge, Button } from 'react-bootstrap';
import { Pencil, Trash2, Calendar } from 'lucide-react';
import { getExpirationStatus, getExpirationLabel } from '../../hooks/useInventory';

// ---------------------------------------------------------------------------
// Expiration styling map (matches design-system CSS tokens)
// ---------------------------------------------------------------------------
const EXPIRATION_STYLES = {
  expired: {
    cardClass: 'expiration-critical',
    badgeStyle: { background: 'var(--mkh-expiring-critical)', color: 'var(--mkh-danger-text)', border: '1px solid var(--mkh-danger-text)' },
    label: 'Expired',
  },
  critical: {
    cardClass: 'expiration-critical',
    badgeStyle: { background: 'var(--mkh-expiring-critical)', color: 'var(--mkh-danger-text)', border: '1px solid var(--mkh-danger-text)' },
    label: 'Critical',
  },
  warning: {
    cardClass: 'expiration-warning',
    badgeStyle: { background: 'var(--mkh-expiring-warning)', color: 'var(--mkh-warning-text)', border: '1px solid var(--mkh-warning-text)' },
    label: 'Soon',
  },
  safe: {
    cardClass: 'expiration-safe',
    badgeStyle: { background: 'var(--mkh-expiring-safe)', color: 'var(--mkh-success-text)', border: '1px solid var(--mkh-success-text)' },
    label: 'Fresh',
  },
};

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
  const status = getExpirationStatus(item.expiresAt);
  const expStyle = EXPIRATION_STYLES[status] ?? EXPIRATION_STYLES.safe;
  const locationIcon = location?.icon ?? LOCATION_TYPE_ICONS[item.locationType] ?? '📦';
  const locationLabel = location?.label ?? item.locationType ?? 'Unknown';

  return (
    <Card
      className={`h-100 shadow-sm ${expStyle.cardClass}`}
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
              ...expStyle.badgeStyle,
              borderRadius: 'var(--mkh-radius-full)',
              fontWeight: 'var(--mkh-font-weight-medium)',
              fontSize: 'var(--mkh-font-size-tiny)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {expStyle.label}
          </Badge>
        </div>

        {/* Quantity row */}
        <div
          style={{
            fontSize: 'var(--mkh-font-size-small)',
            color: 'var(--mkh-text-secondary)',
          }}
        >
          <span className="fw-semibold" style={{ color: 'var(--mkh-text-primary)', fontSize: '1.1rem' }}>
            {item.quantity}
          </span>
          {item.unit && (
            <span className="ms-1">{item.unit}</span>
          )}
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
