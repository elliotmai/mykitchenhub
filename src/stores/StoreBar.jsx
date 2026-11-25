// src/stores/StoreBar.jsx
// Above the shopping list: read it by aisle or store by store, show one
// store's part of it, and keep the list of stores.

import React, { useState } from 'react';
import { Button, Form, InputGroup } from 'react-bootstrap';
import { Store, X } from 'lucide-react';

import { NO_STORE } from './storeLogic';

const TINY = { fontSize: 'var(--mkh-font-size-tiny)' };

/** The small picker beside a line: which store it's bought at. */
export const StoreSelect = ({ item, stores, value, onChange }) => (
  <Form.Select
    size="sm"
    className="flex-shrink-0 mkh-store-select"
    style={{ ...TINY, width: 'auto', maxWidth: '8.5rem', paddingTop: 0, paddingBottom: 0 }}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    aria-label={`Store for ${item.name}`}
  >
    <option value={NO_STORE}>No store</option>
    {stores.map((s) => (
      <option key={s.id} value={s.id}>
        {s.name}
      </option>
    ))}
  </Form.Select>
);

const StoreBar = ({
  stores,
  groupBy,
  onGroupBy,
  storeFilter,
  onStoreFilter,
  onAddStore,
  onRemoveStore,
}) => {
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');

  const add = async (event) => {
    event.preventDefault();
    const result = await onAddStore?.(name);
    if (result?.success) {
      setName('');
      setProblem('');
    } else if (result) setProblem(result.error);
  };

  return (
    <div className="mb-3 d-flex flex-column gap-2">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <div className="btn-group btn-group-sm" role="group" aria-label="Group the list by">
          <Button
            variant={groupBy === 'aisle' ? 'primary' : 'outline-secondary'}
            aria-pressed={groupBy === 'aisle'}
            onClick={() => onGroupBy('aisle')}
          >
            By aisle
          </Button>
          <Button
            variant={groupBy === 'store' ? 'primary' : 'outline-secondary'}
            aria-pressed={groupBy === 'store'}
            onClick={() => onGroupBy('store')}
          >
            By store
          </Button>
        </div>
        {stores.length > 0 && (
          <Form.Select
            size="sm"
            style={{ width: 'auto' }}
            value={storeFilter}
            onChange={(event) => onStoreFilter(event.target.value)}
            aria-label="Show one store"
          >
            <option value="">Every store</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={NO_STORE}>No store yet</option>
          </Form.Select>
        )}
        <Button
          size="sm"
          variant="link"
          className="p-0 d-flex align-items-center gap-1"
          onClick={() => setManaging((m) => !m)}
          aria-expanded={managing}
        >
          <Store size={14} aria-hidden="true" /> Stores
        </Button>
      </div>

      {managing && (
        <div className="d-flex flex-column gap-1">
          {stores.length === 0 && (
            <span className="text-muted" style={TINY}>
              Add the shops you use, then send each item to one.
            </span>
          )}
          <ul className="list-unstyled d-flex flex-wrap gap-1 mb-0">
            {stores.map((s) => (
              <li
                key={s.id}
                className="badge rounded-pill text-bg-light d-flex align-items-center gap-1"
              >
                {s.name}
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 text-muted"
                  aria-label={`Remove ${s.name}`}
                  onClick={() => onRemoveStore?.(s.id)}
                >
                  <X size={12} />
                </Button>
              </li>
            ))}
          </ul>
          <Form onSubmit={add}>
            <InputGroup size="sm">
              <Form.Control
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Costco, Trader Joe's…"
                aria-label="New store"
              />
              <Button type="submit" variant="outline-secondary" disabled={!name.trim()}>
                Add store
              </Button>
            </InputGroup>
          </Form>
          {problem && (
            <span className="text-danger" style={TINY}>
              {problem}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default StoreBar;
