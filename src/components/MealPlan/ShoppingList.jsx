// src/components/MealPlan/ShoppingList.jsx
// What the week's meals still need from the shop — roadmap 7.1.

import React from 'react';
import { Badge, Card } from 'react-bootstrap';
import { Check, ShoppingCart } from 'lucide-react';

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

/**
 * ShoppingList
 *
 * @param {array} items - from buildShoppingList():
 *   { key, name, quantity, unit, onHand, haveInInventory }
 */
const ShoppingList = ({ items = [] }) => {
  const toBuy = items.filter((item) => !item.haveInInventory);
  const covered = items.filter((item) => item.haveInInventory);

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
                {toBuy.map((item) => {
                  const note = stockNote(item);
                  return (
                    <li
                      key={item.key ?? `${item.normalized} ${item.unit}`}
                      style={{ fontSize: 'var(--mkh-font-size-small)' }}
                    >
                      <div className="d-flex justify-content-between align-items-baseline gap-2">
                        <span className="text-capitalize">{item.name}</span>
                        <span className="text-muted text-nowrap">
                          {item.quantity} {item.unit}
                        </span>
                      </div>
                      {note && (
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
                })}
              </ul>
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
                      key={item.key ?? `${item.normalized} ${item.unit}`}
                      className="d-flex align-items-center gap-1 text-muted"
                      style={{ fontSize: 'var(--mkh-font-size-small)' }}
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
