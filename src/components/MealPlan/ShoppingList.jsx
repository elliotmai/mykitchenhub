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

import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, Form, Spinner } from 'react-bootstrap';
import { Check, Pencil, Plus, ShoppingCart, X } from 'lucide-react';

import { amountLabel } from '../../hooks/useShoppingList';
import { groupByStoreSection } from '../../config/storeSections';

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
/**
 * Editing happens in place rather than in a modal.
 *
 * The edit is nearly always a small correction — a typo, a wrong number — made
 * while looking at the row next to it. A dialog would cover the rest of the
 * list to change one word, and on a phone it would cover all of it.
 */
const ManualRow = ({ item, duplicate, busy, onToggleBought, onRemove, onEdit }) => {
  const bought = item.status === 'bought';
  const amount = amountLabel(item);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(item.name);
  const [draftQuantity, setDraftQuantity] = useState(String(item.quantity ?? ''));
  const [draftUnit, setDraftUnit] = useState(item.unit ?? '');
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    // Seeded from the item each time it opens, not held across closes: the row
    // may have changed underneath from another device since the last edit.
    setDraftName(item.name);
    setDraftQuantity(String(item.quantity ?? ''));
    setDraftUnit(item.unit ?? '');
    setEditing(true);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!draftName.trim() || saving) return;
    setSaving(true);
    const result = await onEdit(item, {
      name: draftName,
      quantity: draftQuantity,
      unit: draftUnit,
    });
    setSaving(false);
    // Left open on failure so the correction is not lost — the toast says what
    // went wrong and the words are still there to fix.
    if (result?.success) setEditing(false);
  };

  if (editing) {
    return (
      <li style={SMALL}>
        <Form onSubmit={save} className="d-flex flex-column gap-1">
          <Form.Control
            size="sm"
            value={draftName}
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            aria-label={`Name for ${item.name}`}
          />
          <div className="d-flex gap-1">
            <Form.Control
              size="sm"
              type="number"
              min="0"
              step="any"
              value={draftQuantity}
              onChange={(event) => setDraftQuantity(event.target.value)}
              aria-label={`How many ${item.name}`}
              style={{ maxWidth: '4.5rem' }}
            />
            <Form.Control
              size="sm"
              value={draftUnit}
              onChange={(event) => setDraftUnit(event.target.value)}
              placeholder="unit"
              aria-label={`Unit for ${item.name}`}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline-secondary"
              disabled={!draftName.trim() || saving}
              className="flex-shrink-0"
            >
              {saving ? <Spinner animation="border" size="sm" /> : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="link"
              className="text-muted flex-shrink-0"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </Form>
      </li>
    );
  }

  return (
    <li style={SMALL}>
      <div className="d-flex align-items-baseline gap-2">
        <Form.Check
          type="checkbox"
          // mkh-tickbox: this box has no <label> bound to it — the item name
          // beside it is a span — so unlike the settings toggles there is
          // nothing else to tap and the box itself has to meet the 44px floor.
          className="flex-shrink-0 mkh-tickbox"
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
        {onEdit && (
          <Button
            variant="link"
            size="sm"
            className="p-0 text-muted flex-shrink-0 d-flex align-items-center"
            disabled={busy}
            onClick={startEditing}
            aria-label={`Edit ${item.name}`}
          >
            <Pencil size={13} />
          </Button>
        )}
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
  onEditItem,
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

  // One list of errands, grouped the way the shop is laid out. Manual and
  // derived rows sit together inside an aisle: standing in front of the dairy
  // fridge, where a line came from is not the question — "milk" is one errand
  // whether a recipe asked for it or the cook did.
  //
  // Only pending rows are grouped. Bought and already-have rows keep their own
  // sections below, because they are answers to different questions.
  const manualIds = new Set(pendingManual.map((item) => item.id));
  const aisles = useMemo(
    () => groupByStoreSection([...pendingManual, ...toBuy]),
    [pendingManual, toBuy]
  );
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
              <div className="d-flex flex-column gap-2">
                {aisles.map((aisle) => (
                  <section key={aisle.key} aria-labelledby={`aisle-${aisle.key}`}>
                    <h4
                      id={`aisle-${aisle.key}`}
                      className="text-muted mb-1"
                      style={{
                        fontSize: 'var(--mkh-font-size-tiny)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {aisle.label}
                    </h4>
                    <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                      {aisle.items.map((item) =>
                        manualIds.has(item.id) ? (
                          <ManualRow
                            key={rowKey(item)}
                            item={item}
                            duplicate={duplicateNames.has(item.normalized)}
                            busy={busyItemId === item.id}
                            onToggleBought={onToggleBought}
                            onRemove={onRemoveItem}
                            onEdit={onEditItem}
                          />
                        ) : (
                          <DerivedRow key={rowKey(item)} item={item} />
                        )
                      )}
                    </ul>
                  </section>
                ))}
              </div>
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
