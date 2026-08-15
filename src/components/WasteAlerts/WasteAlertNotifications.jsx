// src/components/WasteAlerts/WasteAlertNotifications.jsx
// The in-app half of the daily alert — roadmap 6.2.
//
// The scheduled function writes a notification every morning whether or not an
// SMS could be sent, so this list is the alert that always arrives.

import React from 'react';
import { Badge, Button, Card, ListGroup } from 'react-bootstrap';
import { Bell, Check, X } from 'lucide-react';

/** Firestore Timestamp, Date or ISO string → something a person can read. */
const formatWhen = (value) => {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * WasteAlertNotifications
 *
 * @param {Array}    notifications
 * @param {function} onMarkRead - async (id) => void
 * @param {function} onDismiss  - async (id) => void
 */
const WasteAlertNotifications = ({ notifications = [], onMarkRead, onDismiss }) => {
  if (notifications.length === 0) return null;

  return (
    <Card className="mb-4" data-testid="waste-alert-notifications">
      <Card.Header className="bg-transparent d-flex align-items-center gap-2">
        <Bell size={18} className="text-warning" aria-hidden="true" />
        <h5 className="mb-0">Your daily alerts</h5>
      </Card.Header>
      <ListGroup variant="flush">
        {notifications.map((notification) => (
          <ListGroup.Item
            key={notification.id}
            className="d-flex justify-content-between align-items-start gap-3"
            data-testid="waste-alert-notification"
          >
            <div className="min-w-0">
              <div className="fw-semibold d-flex align-items-center gap-2">
                {notification.title}
                {!notification.read && (
                  <Badge bg="warning" text="dark">
                    New
                  </Badge>
                )}
              </div>
              <div className="text-muted small">{notification.body}</div>
              <div className="text-muted" style={{ fontSize: 'var(--mkh-font-size-tiny)' }}>
                {formatWhen(notification.createdAt)}
                {notification.channel === 'sms' ? ' · also sent by text' : ''}
              </div>
            </div>

            <div className="d-flex gap-1 flex-shrink-0">
              {!notification.read && (
                <Button
                  size="sm"
                  variant="light"
                  aria-label={`Mark "${notification.title}" as read`}
                  onClick={() => onMarkRead?.(notification.id)}
                >
                  <Check size={14} aria-hidden="true" />
                </Button>
              )}
              <Button
                size="sm"
                variant="light"
                aria-label={`Dismiss "${notification.title}"`}
                onClick={() => onDismiss?.(notification.id)}
              >
                <X size={14} aria-hidden="true" />
              </Button>
            </div>
          </ListGroup.Item>
        ))}
      </ListGroup>
    </Card>
  );
};

export default WasteAlertNotifications;
