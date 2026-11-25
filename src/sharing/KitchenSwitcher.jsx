// src/sharing/KitchenSwitcher.jsx
// For someone in more than one kitchen (their household, and ones they plan
// events with): which kitchen the app is showing.

import React from 'react';
import { Form } from 'react-bootstrap';

import { useKitchen } from '../components/Auth/HouseholdGate';

const keyOf = (s) => (s ? `${s.household_id}|${s.kind}|${s.event_id || ''}` : 'own');
const labelOf = (s) =>
  s.kind === 'partner' ? `${s.household} (events and recipes)` : `${s.household}: one event`;

const KitchenSwitcher = ({ className = '' }) => {
  const { own, shares = [], active, switchTo } = useKitchen();
  if (!shares.length || (!own && shares.length === 1)) return null;
  return (
    <Form.Select
      size="sm"
      className={className}
      style={{ width: 'auto', maxWidth: '16rem' }}
      value={keyOf(active)}
      onChange={(e) => switchTo(shares.find((s) => keyOf(s) === e.target.value) || null)}
      aria-label="Which kitchen"
    >
      {own && <option value="own">My household</option>}
      {shares.map((s) => (
        <option key={keyOf(s)} value={keyOf(s)}>
          {labelOf(s)}
        </option>
      ))}
    </Form.Select>
  );
};

export default KitchenSwitcher;
