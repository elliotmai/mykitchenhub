// src/components/MealPlan/ShoppingList.jsx
// What the week's meals still need from the shop — roadmap 7.1 — plus the
// things a cook asked for that no recipe did.
//
// Two kinds of row, from two different places, deliberately not merged:
//
//   Derived   computed by buildShoppingList() from the week's meals minus the
//             kitchen. No document behind it, so nothing about it can be
//             stored — including whether it has been bought.
//   Manual    a document in users/{uid}/shoppingItems (see useShoppingList).
//             Survives a reload and the week rolling over, and can be ticked
//             off.
//
// Rows you can tick have a checkbox; rows the week computed do not. That is the
// whole visual grammar, and it is honest: there is nowhere to record that a
// derived row was bought, and quietly creating a document for one would make
// the same list true in two places.

import React, { useState } from 'react';
import { Badge, Button, Card, Form, Spinner } from 'react-bootstrap';
import { Check, Plus, ShoppingCart, X } from 'lucide-react';

import { amountLabel } from '../../hooks/useShoppingList';

// Re-exported because the fridge board renders the same rows from the same
// helper: one definition, two surfaces.
export { amountLabel };

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

const SMALL = { fontSize: 'var(--mkh-font-size-small)' };
const TINY = { fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-muted)' };
const NOTE_INDENT = { ...TINY, marginLeft: '1.65rem' };

/** Keeps a derived row's text lined up with the manual rows' checkboxes. */
const TickSpacer = () => (
  <span aria-hidden="true" style={{ display: 'inline-block', width: '1.15rem', flexShrink: 0 }} />
);

/**
 * One thing a cook typed in themselves.
 *
 * Bucketed by its own `status`, never by `haveInInventory` — a manual item has
 * no needed-versus-on-hand comparison behind it, so it does not carry that
 * field at all.
 */
const ManualRow = ({ item, duplicate, busy, onToggleBought, onRemove }) => {
  const bought = item.status === 'bought';
  const amount = amountLabel(item);

  return (
    <li style={SMALL}>
      <div className="d-flex align-items-baseline gap-2">
        <Form.Check
          type="checkbox"
          className="flex-shrink-0"
          checked={bought}
          disabled={busy}
          onChange={() => onToggleBought(item, !bought)}
          aria-label={bought ? `Put ${item.name} back on the list` : `Tick ${item.name} off`}
        />
        <span
          className={`text-capitalize flex-grow-1${bought ? ' text-muted' : ''}`}
          style={bought ? { textDecoration: 'line-through' } : undefined}
        >
          {item.name}
        </span>
        {amount && <span className="text-muted text-nowrap">{amount}</span>}
        <Button
          variant="link"
          size="sm"
          className="p-0 text-muted flex-shrink-0 d-flex align-items-center"
          disabled={busy}
          onClick={() => onRemove(item)}
          aria-label={`Remove ${item.name}`}
        >
          <X size={13} />
        </Button>
      </div>

      {item.notes && <div style={NOTE_INDENT}>{item.notes}</div>}

      {duplicate && !bought && (
        // Shown, not merged. The two quantities come from different places and
        // one of them is a guess, so summing them would produce a number that is
        // wrong in both units — the cook decides which one they meant.
        <div style={NOTE_INDENT}>this week&rsquo;s meals need it too</div>
      )}
    </li>
  );
};

/** One line the week's meals produced. Nothing to tick — there is no document. */
const DerivedRow = ({ item }) => {
  const note = stockNote(item);

  return (
    <li style={SMALL}>
      <div className="d-flex align-items-baseline gap-2">
        <TickSpacer />
        <span className="text-capitalize flex-grow-1">{item.name}</span>
        <span className="text-muted text-nowrap">
          {item.quantity} {item.unit}
        </span>
      </div>
      {note && <div style={NOTE_INDENT}>{note}</div>}
    </li>
  );
};

const rowKey = (item) => item.key ?? item.id ?? `${item.normalized} ${item.unit}`;

/**
 * ShoppingList
 *
 * @param {array}    items           derived rows from buildShoppingList():
 *                                   { key, name, quantity, unit, onHand, haveInInventory }
 * @param {array}    manualItems     documents from useShoppingList()
 * @param {Set}      duplicateNames  normalized names on both lists at once
 * @param {string}   busyItemId      the manual row with a write in flight
 * @param {function} onAddItem       ({ name, quantity, unit }) => Promise
 * @param {function} onToggleBought  (item, bought) => Promise
 * @param {function} onRemoveItem    (item) => Promise
 * @param {function} onClearBought   () => Promise
 *
 * The manual half renders only when `onAddItem` is supplied, so a caller that
 * wants the derived list alone still gets exactly what it always did.
 */
const ShoppingList = ({
  items = [],
  manualItems = [],
  duplicateNames = new Set(),
  busyItemId = null,
  onAddItem,
  onToggleBought,
  onRemoveItem,
  onClearBought,
}) => {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [adding, setAdding] = useState(false);

  // `haveInInventory` is only ever set on a derived row, and only ever by
  // buildShoppingList. Bucketing on `=== true` rather than on truthiness means
  // a row that never carried the field cannot drift into "already in your
  // kitchen" — the one bucket where something silently stops being a thing the
  // cook still has to buy.
  const toBuy = items.filter((item) => item.haveInInventory !== true);
  const covered = items.filter((item) => item.haveInInventory === true);

  const canAdd = Boolean(onAddItem);
  const pendingManual = manualItems.filter((item) => item.status !== 'bought');
  const boughtManual = manualItems.filter((item) => item.status === 'bought');

  const outstanding = toBuy.length + pendingManual.length;
  const isEmpty = items.length === 0 && manualItems.length === 0;

  const handleAdd = async (event) => {
    event.preventDefault();
    if (!name.trim() || adding) return;

    setAdding(true);
    const result = await onAddItem({ name, quantity, unit });
    setAdding(false);

    // Only empty the boxes on a write that landed — a cook whose item was
    // refused should not have to retype it as well.
    if (result?.success) {
      setName('');
      setQuantity('');
      setUnit('');
    }
  };

  return (
    <Card className="shadow-sm h-100" style={{ borderRadius: 'var(--mkh-radius-lg)' }}>
      <Card.Body className="p-3">
        <div className="d-flex align-items-center gap-2 mb-2">
          <ShoppingCart size={18} />
          <span className="fw-semibold">Shopping list</span>
          <Badge bg="secondary" className="ms-auto">
            {outstanding}
          </Badge>
        </div>

        {canAdd && (
          <Form onSubmit={handleAdd} className="mb-3">
            <Form.Control
              size="sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Anything else? e.g. batteries"
              aria-label="Add something to the shopping list"
              className="mb-1"
            />
            <div className="d-flex gap-1">
              <Form.Control
                size="sm"
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder="1"
                aria-label="How many"
                style={{ maxWidth: '4.5rem' }}
              />
              <Form.Control
                size="sm"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="unit"
                aria-label="Unit"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline-secondary"
                className="d-flex align-items-center gap-1 flex-shrink-0"
                disabled={!name.trim() || adding}
              >
                {adding ? <Spinner animation="border" size="sm" /> : <Plus size={14} />}
                Add
              </Button>
            </div>
          </Form>
        )}

        {isEmpty ? (
          <p className="text-muted mb-0" style={SMALL}>
            {canAdd
              ? 'Add meals to the week and everything they need shows up here — or type anything else you need above.'
              : 'Add meals to the week and everything they need shows up here.'}
          </p>
        ) : (
          <>
            {outstanding === 0 ? (
              <p className="text-muted mb-2" style={SMALL}>
                {items.length > 0
                  ? 'Your kitchen already has everything this week needs.'
                  : 'Nothing left to buy.'}
              </p>
            ) : (
              <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                {/* Manual rows first: the one just typed belongs where the cook
                    can see it landed. */}
                {pendingManual.map((item) => (
                  <ManualRow
                    key={rowKey(item)}
                    item={item}
                    duplicate={duplicateNames.has(item.normalized)}
                    busy={busyItemId === item.id}
                    onToggleBought={onToggleBought}
                    onRemove={onRemoveItem}
                  />
                ))}
                {toBuy.map((item) => (
                  <DerivedRow key={rowKey(item)} item={item} />
                ))}
              </ul>
            )}

            {boughtManual.length > 0 && (
              <div className="mt-3">
                <div className="d-flex align-items-center gap-2 mb-1">
                  <span
                    className="text-muted"
                    style={{ fontSize: 'var(--mkh-font-size-tiny)', textTransform: 'uppercase' }}
                  >
                    In the trolley
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 ms-auto"
                    style={{ fontSize: 'var(--mkh-font-size-tiny)' }}
                    onClick={onClearBought}
                  >
                    Clear
                  </Button>
                </div>
                <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                  {boughtManual.map((item) => (
                    <ManualRow
                      key={rowKey(item)}
                      item={item}
                      duplicate={false}
                      busy={busyItemId === item.id}
                      onToggleBought={onToggleBought}
                      onRemove={onRemoveItem}
                    />
                  ))}
                </ul>
              </div>
            )}

            {covered.length > 0 && (
              <div className="mt-3">
                <div
                  className="text-muted mb-1"
                  style={{ fontSize: 'var(--mkh-font-size-tiny)', textTransform: 'uppercase' }}
                >
                  Already in your kitchen
                </div>
                <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                  {covered.map((item) => (
                    <li
                      key={rowKey(item)}
                      className="d-flex align-items-center gap-1 text-muted"
                      style={SMALL}
                    >
                      <Check size={13} />
                      <span className="text-capitalize">{item.name}</span>
                    </li>
                  ))}
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
