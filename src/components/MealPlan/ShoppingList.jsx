// src/components/MealPlan/ShoppingList.jsx
// What the week's meals still need from the shop — roadmap 7.1 — plus
// whatever the household added itself, by hand or through the Alexa skill.
//
// Rows arrive already merged (mergeShoppingList in src/hooks/useShoppingList.js)
// and carry `fromPlan` to say which of the two they came from.

import React, { useState } from 'react';
import { Badge, Button, Card, Form } from 'react-bootstrap';
import { Check, Mic, Plus, ShoppingCart, X } from 'lucide-react';

/**
 * What the kitchen already has of something still on the list.
 *
 * Two cases worth telling the cook about: a partly-stocked item (buy the
 * difference, not the whole amount), and stock recorded in a unit the recipe
 * does not use — which cannot be counted against it, but is still there.
 */
export const stockNote = (item) => {
  const notes = [];

  const onHand = Number(item?.onHand || 0);
  const needed = Number(item?.quantity || 0);
  if (onHand > 0 && onHand < needed) {
    notes.push(`${Math.round(onHand * 100) / 100}${item.unit ? ` ${item.unit}` : ''} in stock`);
  }

  (item?.otherUnits || []).forEach(({ quantity, unit }) => {
    if (!quantity) return;
    notes.push(`${Math.round(quantity * 100) / 100} ${unit} in stock — different measure`);
  });

  return notes.length ? notes.join(' · ') : null;
};

/** Is this row done with — bought, or already in the kitchen? */
export const isSettled = (item) => item?.status === 'bought' || Boolean(item?.haveInInventory);

/**
 * ShoppingList
 *
 * @param {array}    items    - merged rows: { key, name, quantity, unit, onHand,
 *                              haveInInventory, fromPlan, id?, status?, source? }
 * @param {function} onAdd    - ({ name }) => Promise, adding a row by hand
 * @param {function} onToggle - (item) => Promise, ticking one off or back on
 * @param {function} onRemove - (item) => Promise, only ever called with a
 *                              stored row; meal-plan rows have no document to
 *                              delete and are removed by changing the week
 */
const ShoppingList = ({ items = [], onAdd, onToggle, onRemove }) => {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const toBuy = items.filter((item) => !isSettled(item));
  const settled = items.filter(isSettled);

  const submitDraft = async (event) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || !onAdd || busy) return;

    setBusy(true);
    const result = await onAdd({ name });
    setBusy(false);
    if (result?.success !== false) setDraft('');
  };

  const renderRow = (item) => {
    const note = stockNote(item);
    const done = isSettled(item);

    return (
      <li key={item.id ?? item.key} style={{ fontSize: 'var(--mkh-font-size-small)' }}>
        <div className="d-flex justify-content-between align-items-baseline gap-2">
          <span className="d-flex align-items-baseline gap-1">
            {onToggle && (
              <Form.Check
                type="checkbox"
                checked={done}
                onChange={() => onToggle(item)}
                aria-label={done ? `Put ${item.name} back on the list` : `Got ${item.name}`}
              />
            )}
            <span
              className={`text-capitalize${done ? ' text-muted text-decoration-line-through' : ''}`}
            >
              {item.name}
            </span>
            {item.source === 'alexa' && (
              // Worth showing: an item nobody remembers typing is less
              // alarming when the list says where it came from.
              <Mic size={12} className="text-muted" aria-label="Added by voice" />
            )}
          </span>

          <span className="d-flex align-items-baseline gap-1 text-muted text-nowrap">
            {item.quantity ? (
              <span>
                {item.quantity} {item.unit}
              </span>
            ) : null}
            {onRemove && item.id && !item.fromPlan && (
              <Button
                variant="link"
                size="sm"
                className="p-0 text-muted lh-1"
                onClick={() => onRemove(item)}
                aria-label={`Remove ${item.name}`}
              >
                <X size={14} />
              </Button>
            )}
          </span>
        </div>
        {note && !done && (
          <div
            style={{
              fontSize: 'var(--mkh-font-size-tiny)',
              color: 'var(--mkh-text-muted)',
            }}
          >
            {note}
          </div>
        )}
      </li>
    );
  };

  return (
    <Card className="shadow-sm h-100" style={{ borderRadius: 'var(--mkh-radius-lg)' }}>
      <Card.Body className="p-3">
        <div className="d-flex align-items-center gap-2 mb-2">
          <ShoppingCart size={18} />
          <span className="fw-semibold">Shopping list</span>
          <Badge bg="secondary" className="ms-auto">
            {toBuy.length}
          </Badge>
        </div>

        {onAdd && (
          <Form onSubmit={submitDraft} className="d-flex gap-1 mb-2">
            <Form.Control
              size="sm"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add to the list…"
              aria-label="Add an item to the shopping list"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline-secondary"
              disabled={!draft.trim() || busy}
            >
              <Plus size={14} />
            </Button>
          </Form>
        )}

        {items.length === 0 ? (
          <p className="text-muted mb-0" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
            Add meals to the week and everything they need shows up here.
          </p>
        ) : (
          <>
            {toBuy.length === 0 ? (
              <p className="text-muted mb-2" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
                Your kitchen already has everything this week needs.
              </p>
            ) : (
              <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                {toBuy.map(renderRow)}
              </ul>
            )}

            {settled.length > 0 && (
              <div className="mt-3">
                <div
                  className="text-muted mb-1"
                  style={{ fontSize: 'var(--mkh-font-size-tiny)', textTransform: 'uppercase' }}
                >
                  Got it
                </div>
                <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                  {settled.map((item) =>
                    // A row that is only "settled" because the kitchen already
                    // has it was never bought and cannot be un-bought — it gets
                    // the old read-only treatment.
                    item.haveInInventory && !item.id ? (
                      <li
                        key={item.key}
                        className="d-flex align-items-center gap-1 text-muted"
                        style={{ fontSize: 'var(--mkh-font-size-small)' }}
                      >
                        <Check size={13} />
                        <span className="text-capitalize">{item.name}</span>
                      </li>
                    ) : (
                      renderRow(item)
                    )
                  )}
                </ul>
              </div>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default ShoppingList;
