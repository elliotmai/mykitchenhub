// src/components/MealPlan/DayCard.jsx
// One day of the 7-day timeline — roadmap 7.1.
//
// Doubles as a drop target: dragging a meal card onto another day reschedules
// it. The native HTML5 drag events are enough here and keep the bundle free of
// a drag-and-drop dependency; the `Move to` select beside each meal is the
// keyboard path to the same thing.

import React, { useState } from 'react';
import { Badge, Button, Card, Form } from 'react-bootstrap';
import { Check, GripVertical, Plus, Pencil, Trash2, UtensilsCrossed } from 'lucide-react';

export const DRAG_TYPE = 'application/x-mykitchenhub-meal';

const MEAL_TYPE_ICONS = {
  breakfast: '🍳',
  lunch: '🥪',
  dinner: '🍽️',
  snack: '🍎',
};

const STATUS_BADGES = {
  cooked: { label: 'Cooked', variant: 'success' },
  skipped: { label: 'Skipped', variant: 'secondary' },
};

const MealEntry = ({ entry, days, onCook, onRemove, onMove, onEdit, busy }) => {
  const cooked = entry.status === 'cooked';
  // `skipped` is part of the shared entry contract, so it has to render as
  // something other than "still for dinner".
  const settled = cooked || entry.status === 'skipped';
  const badge = STATUS_BADGES[entry.status];

  const handleDragStart = (event) => {
    event.dataTransfer?.setData?.(DRAG_TYPE, entry.id);
    event.dataTransfer?.setData?.('text/plain', entry.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable={!settled}
      onDragStart={handleDragStart}
      data-testid={`meal-entry-${entry.id}`}
      className="d-flex flex-column gap-1 p-2"
      style={{
        borderRadius: 'var(--mkh-radius-md)',
        border: '1px solid var(--mkh-border)',
        background: cooked ? 'var(--mkh-expiring-safe)' : 'var(--mkh-surface, #fff)',
        opacity: settled ? 0.75 : 1,
        cursor: settled ? 'default' : 'grab',
      }}
    >
      <div className="d-flex align-items-start gap-1">
        {!settled && (
          <GripVertical size={14} className="text-muted flex-shrink-0 mt-1" aria-hidden="true" />
        )}
        <div className="flex-grow-1 min-width-0">
          <div
            className="fw-semibold text-truncate"
            style={{ fontSize: 'var(--mkh-font-size-small)' }}
            title={entry.recipeName}
          >
            {entry.recipeName}
          </div>
          <div
            className="d-flex align-items-center gap-2"
            style={{ fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-secondary)' }}
          >
            <span>
              {MEAL_TYPE_ICONS[entry.mealType] ?? '🍽️'} {entry.mealType}
            </span>
            <span>
              · {entry.servings} serving{entry.servings === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        {badge && (
          <Badge bg={badge.variant} style={{ fontSize: 'var(--mkh-font-size-tiny)' }}>
            {badge.label}
          </Badge>
        )}
      </div>

      {entry.source !== 'manual' && (
        <div style={{ fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-muted)' }}>
          {entry.source === 'ai' && 'Suggested by the planner'}
          {entry.source === 'hellofresh' && 'From your HelloFresh box'}
          {entry.source === 'waste-prevention' && 'Uses something about to expire'}
        </div>
      )}

      {/* A cooked or skipped meal keeps its remove button: logging the wrong
          meal, or scheduling a recipe that has since been deleted, otherwise
          leaves a card with no way off the board. */}
      <div className="d-flex gap-1 align-items-center">
        {!settled && (
          <>
            <Button
              size="sm"
              variant="outline-success"
              className="d-flex align-items-center gap-1 py-0"
              style={{ fontSize: 'var(--mkh-font-size-tiny)' }}
              disabled={busy}
              onClick={() => onCook(entry)}
            >
              <Check size={12} aria-hidden="true" />
              Cooked
            </Button>
            <Form.Select
              size="sm"
              aria-label={`Move ${entry.recipeName} to another day`}
              value={entry.date}
              onChange={(event) => onMove(entry, event.target.value)}
              style={{ fontSize: 'var(--mkh-font-size-tiny)', maxWidth: '6.5rem' }}
            >
              {days.map((day) => (
                <option key={day.key} value={day.key}>
                  {day.label} {day.dayOfMonth}
                </option>
              ))}
            </Form.Select>
          </>
        )}
        {onEdit && (
          <Button
            size="sm"
            variant="link"
            className="p-0 ms-auto text-muted"
            aria-label={`Edit ${entry.recipeName}`}
            disabled={busy}
            onClick={() => onEdit(entry)}
          >
            <Pencil size={13} aria-hidden="true" />
          </Button>
        )}
        <Button
          size="sm"
          variant="link"
          className={onEdit ? 'p-0' : 'p-0 ms-auto'}
          aria-label={`Remove ${entry.recipeName}`}
          style={{ color: 'var(--mkh-danger-text)' }}
          onClick={() => onRemove(entry)}
        >
          <Trash2 size={13} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};

/**
 * DayCard
 *
 * @param {object}   day      - one entry from buildWeekDays()
 * @param {array}    entries  - meals scheduled on this day, already sorted
 * @param {array}    days     - all seven days, for the "move to" select
 * @param {function} onAdd    - (dayKey) => void
 * @param {function} onCook   - (entry) => void
 * @param {function} onRemove - (entry) => void
 * @param {function} onMove   - (entry, dayKey) => void
 * @param {function} onDropMeal - (entryId, dayKey) => void
 * @param {string}   busyEntryId - the one meal whose "Cooked" write is in flight
 */
const DayCard = ({
  day,
  entries = [],
  days = [],
  onAdd,
  onCook,
  onRemove,
  onEdit,
  onMove,
  onDropMeal,
  busyEntryId = null,
}) => {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  };

  // Dragging across a child element fires dragleave on the card. Ignoring the
  // ones that stay inside keeps the drop outline from strobing.
  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragOver(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    const entryId =
      event.dataTransfer?.getData?.(DRAG_TYPE) || event.dataTransfer?.getData?.('text/plain');
    if (entryId) onDropMeal?.(entryId, day.key);
  };

  return (
    <Card
      data-testid={`day-card-${day.key}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="h-100 shadow-sm"
      style={{
        borderRadius: 'var(--mkh-radius-lg)',
        border: dragOver
          ? '2px dashed var(--mkh-primary, #3498db)'
          : `1px solid ${day.isToday ? 'var(--mkh-primary, #3498db)' : 'var(--mkh-border)'}`,
        background: day.isPast ? 'var(--mkh-surface-muted, #f8f9fa)' : undefined,
      }}
    >
      <Card.Body className="p-2 d-flex flex-column gap-2">
        <div className="d-flex justify-content-between align-items-baseline">
          <span className="fw-semibold" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
            {day.label}
            {day.isToday && (
              <Badge bg="primary" className="ms-1" style={{ fontSize: '0.6rem' }}>
                Today
              </Badge>
            )}
          </span>
          <span
            style={{ fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-secondary)' }}
          >
            {day.monthLabel} {day.dayOfMonth}
          </span>
        </div>

        {entries.length === 0 ? (
          <div
            className="text-center py-3 d-flex flex-column align-items-center gap-1"
            style={{ color: 'var(--mkh-text-muted)', fontSize: 'var(--mkh-font-size-tiny)' }}
          >
            <UtensilsCrossed size={18} className="opacity-50" />
            Nothing planned
          </div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {entries.map((entry) => (
              <MealEntry
                key={entry.id}
                entry={entry}
                days={days}
                onCook={onCook}
                onRemove={onRemove}
                onMove={onMove}
                onEdit={onEdit}
                busy={busyEntryId === entry.id}
              />
            ))}
          </div>
        )}

        <Button
          size="sm"
          variant="light"
          className="mt-auto d-flex align-items-center justify-content-center gap-1"
          style={{ fontSize: 'var(--mkh-font-size-tiny)' }}
          onClick={() => onAdd(day.key)}
          aria-label={`Add a meal on ${day.label} ${day.dayOfMonth}`}
        >
          <Plus size={13} />
          Add meal
        </Button>
      </Card.Body>
    </Card>
  );
};

export default DayCard;
