// src/components/WasteAlerts/ExpirationSummary.jsx
// The headline count: how much food is at risk, split by how urgent it is.

import React from 'react';
import { Card, Col, Row } from 'react-bootstrap';

import { EXPIRATION_LEVELS } from '../../hooks/useInventory';

const TILES = [
  { key: 'expired', level: EXPIRATION_LEVELS.expired, caption: 'Already past its date' },
  { key: 'critical', level: EXPIRATION_LEVELS.critical, caption: 'Within 2 days' },
  { key: 'warning', level: EXPIRATION_LEVELS.warning, caption: 'Within 5 days' },
];

/**
 * ExpirationSummary
 *
 * @param {object} counts - { expired, critical, warning, total }
 */
const ExpirationSummary = ({ counts }) => (
  <Row className="g-3 mb-4">
    {TILES.map(({ key, level, caption }) => (
      <Col xs={12} md={4} key={key}>
        <Card
          className="h-100"
          data-testid={`summary-${key}`}
          style={{ borderLeft: `4px solid ${level.foreground}` }}
        >
          <Card.Body className="py-3">
            <div className="d-flex align-items-baseline gap-2">
              <span className="h3 mb-0" style={{ color: level.foreground }}>
                {counts?.[key] ?? 0}
              </span>
              <span className="fw-semibold">{level.label}</span>
            </div>
            <div className="text-muted small">{caption}</div>
          </Card.Body>
        </Card>
      </Col>
    ))}
  </Row>
);

export default ExpirationSummary;
