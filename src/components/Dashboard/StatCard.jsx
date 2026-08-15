// src/components/Dashboard/StatCard.jsx
// One number on the dashboard: a label, the value, and an icon that repeats the
// meaning so a tile never leans on colour alone.

import React from 'react';
import { Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';

/**
 * Compact a count the way a person would read it: 942, 1.2K, 15K.
 * Already-formatted values (money, ranges) are passed through as strings.
 */
export const formatStatValue = (value) => {
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1000000) {
    const k = value / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  const m = value / 1000000;
  return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
};

/**
 * StatCard
 *
 * @param {string} label - what the number is, in sentence case
 * @param {number|string|null} value - the number; anything unreadable renders a dash
 * @param {React.ElementType} icon - lucide icon component
 * @param {'default'|'warning'|'danger'|'success'} tone - accent for the icon chip
 * @param {string} hint - one short line under the label
 * @param {string} to - optional route; makes the whole tile a link
 * @param {boolean} loading - show a placeholder rather than a misleading zero
 */
const StatCard = ({
  label,
  value = null,
  icon: Icon = null,
  tone = 'default',
  hint = '',
  to = '',
  loading = false,
}) => {
  const body = (
    <Card.Body className="stat-card__body">
      {Icon ? (
        <span className={`stat-card__icon stat-card__icon--${tone}`} aria-hidden="true">
          <Icon size={20} />
        </span>
      ) : null}
      <span className="stat-card__value" data-testid="stat-card-value">
        {loading ? '—' : formatStatValue(value)}
      </span>
      <span className="stat-card__label">{label}</span>
      {hint ? <span className="stat-card__hint">{hint}</span> : null}
    </Card.Body>
  );

  const className = `stat-card h-100 stat-card--${tone}`;

  if (to) {
    return (
      <Card as={Link} to={to} className={`${className} stat-card--link`}>
        {body}
      </Card>
    );
  }

  return <Card className={className}>{body}</Card>;
};

export default StatCard;
