// src/components/WasteAlerts/ExpiringItemsList.jsx
// A compact, colour-coded list of everything about to expire — soonest first.

import React from 'react';
import { Badge, Card, ListGroup } from 'react-bootstrap';
import { PartyPopper } from 'lucide-react';

import {
  getExpirationBadgeStyle,
  getExpirationLabel,
  getExpirationLevel,
} from '../../hooks/useInventory';

const LOCATION_TYPE_ICONS = {
  fridge: '🧊',
  freezer: '❄️',
  pantry: '🏺',
};

/**
 * ExpiringItemsList
 *
 * @param {Array}  items     - inventory documents, already sorted
 * @param {Array}  locations - storageLocation documents, for labels
 */
const ExpiringItemsList = ({ items = [], locations = [] }) => {
  const locationLabel = (item) => {
    const match = locations.find((l) => l.id === item.locationId);
    return {
      icon: match?.icon ?? LOCATION_TYPE_ICONS[item.locationType] ?? '📦',
      label: match?.label ?? item.locationType ?? 'Unknown',
    };
  };

  if (items.length === 0) {
    return (
      <Card>
        <Card.Body className="text-center py-5">
          <PartyPopper size={48} className="text-muted mb-3 opacity-50" aria-hidden="true" />
          <h5 className="mb-1">Nothing is about to go off</h5>
          <p className="text-muted mb-0">
            Everything in your kitchen has more than five days left.
          </p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <ListGroup variant="flush">
        {items.map((item) => {
          const level = getExpirationLevel(item.expiresAt);
          const { icon, label } = locationLabel(item);

          return (
            <ListGroup.Item
              key={item.id}
              className={`d-flex justify-content-between align-items-center gap-3 ${level.cardClass}`}
              data-testid="expiring-item"
            >
              <div className="min-w-0">
                <div className="fw-semibold text-truncate text-capitalize">{item.name}</div>
                <div className="text-muted small">
                  {item.quantity}
                  {item.unit ? ` ${item.unit}` : ''} · {icon} {label}
                </div>
              </div>
              <div className="text-end flex-shrink-0">
                <Badge
                  style={{
                    ...getExpirationBadgeStyle(item.expiresAt),
                    borderRadius: 'var(--mkh-radius-full)',
                  }}
                >
                  {level.label}
                </Badge>
                <div className="text-muted" style={{ fontSize: 'var(--mkh-font-size-tiny)' }}>
                  {getExpirationLabel(item.expiresAt)}
                </div>
              </div>
            </ListGroup.Item>
          );
        })}
      </ListGroup>
    </Card>
  );
};

export default ExpiringItemsList;
