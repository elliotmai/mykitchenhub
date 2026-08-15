// src/components/Dashboard/UrgentAlerts.jsx
// The "cook this first" list: everything already expired or about to be.
//
// Derived straight from inventory expiry dates rather than from a stored alert
// document, so it is correct the moment an item is added and needs nothing from
// the Phase 6 alerting work.

import React from 'react';
import { Card, Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { getExpirationStatus, getExpirationLabel } from '../../hooks/useInventory';

/** Urgent means expired or within the two-day critical window. */
const URGENT_STATUSES = ['expired', 'critical'];

const STATUS_META = {
  expired: { label: 'Expired', className: 'urgent-alert--expired', order: 0 },
  critical: { label: 'Use today', className: 'urgent-alert--critical', order: 1 },
};

/**
 * Turn an inventory list into the alert rows the dashboard shows.
 *
 * Sorted worst-first, then by how soon it goes, so the top row is always the
 * thing most likely to be thrown away.
 *
 * @param {Array} items - inventory documents
 * @param {number} max - how many rows to return
 */
export const buildUrgentAlerts = (items = [], max = 5) =>
  items
    .filter(
      (item) => item?.expiresAt && URGENT_STATUSES.includes(getExpirationStatus(item.expiresAt))
    )
    .map((item) => {
      const status = getExpirationStatus(item.expiresAt);
      return {
        id: item.id,
        name: item.name || 'Unnamed item',
        status,
        statusLabel: STATUS_META[status].label,
        detail: getExpirationLabel(item.expiresAt),
        locationType: item.locationType || '',
        expiresAt: item.expiresAt,
      };
    })
    .sort((a, b) => {
      const byStatus = STATUS_META[a.status].order - STATUS_META[b.status].order;
      if (byStatus !== 0) return byStatus;
      const at = a.expiresAt?.toDate ? a.expiresAt.toDate() : new Date(a.expiresAt);
      const bt = b.expiresAt?.toDate ? b.expiresAt.toDate() : new Date(b.expiresAt);
      return at - bt;
    })
    .slice(0, max);

/**
 * UrgentAlerts
 *
 * @param {Array} items - inventory documents
 * @param {boolean} loading - inventory still arriving
 * @param {number} max - rows to show before "view all"
 */
const UrgentAlerts = ({ items = [], loading = false, max = 5 }) => {
  // Built once and sliced, rather than built twice: the second call existed
  // only to count the rows the first one had already thrown away.
  const urgent = buildUrgentAlerts(items, Number.MAX_SAFE_INTEGER);
  const alerts = urgent.slice(0, max);
  const totalUrgent = urgent.length;

  return (
    <Card className="h-100 urgent-alerts">
      <Card.Header className="bg-transparent d-flex align-items-center justify-content-between">
        <h5 className="mb-0 d-flex align-items-center">
          <AlertTriangle size={18} className="me-2 text-warning" aria-hidden="true" />
          Urgent Alerts
        </h5>
        {totalUrgent > 0 ? (
          <Badge bg="danger" className="urgent-alerts__count">
            {totalUrgent}
          </Badge>
        ) : null}
      </Card.Header>

      <Card.Body>
        {loading ? (
          <p className="text-muted mb-0">Checking what needs using up…</p>
        ) : alerts.length === 0 ? (
          <div className="text-center text-muted py-4">
            <CheckCircle2 size={48} className="mb-3 opacity-50" aria-hidden="true" />
            <p className="mb-1">Nothing needs rescuing today.</p>
            <p className="small mb-0">Items expiring within two days show up here.</p>
          </div>
        ) : (
          <>
            <ul className="urgent-alerts__list">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`urgent-alert ${STATUS_META[alert.status].className}`}
                >
                  <AlertTriangle size={16} className="urgent-alert__icon" aria-hidden="true" />
                  <span className="urgent-alert__name">{alert.name}</span>
                  <span className="urgent-alert__status">{alert.statusLabel}</span>
                  <span className="urgent-alert__detail">{alert.detail}</span>
                </li>
              ))}
            </ul>

            {totalUrgent > alerts.length ? (
              <p className="text-muted small mb-2">
                and {totalUrgent - alerts.length} more waiting in the inventory.
              </p>
            ) : null}

            <Link
              to="/inventory"
              className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-2"
            >
              Open inventory
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default UrgentAlerts;
