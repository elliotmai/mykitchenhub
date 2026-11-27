// src/events/EventCard.jsx
// One event: its guests and notes, and each of its days with a date, a
// status and a menu of dishes and recipes. A day's menu (or the whole
// event's) goes onto the shopping list by item, no amounts, each line in the
// store it's usually bought at.

import React, { useId, useMemo, useState } from 'react';
import { Badge, Button, Card, Form, InputGroup } from 'react-bootstrap';
import { CalendarDays, Plus, ShoppingCart, Trash2, Users, X } from 'lucide-react';

import { recipeLabel } from '../components/MealPlan/ScheduleMealModal';
import ShareControls from '../sharing/ShareControls';
import {
  EVENT_STATUSES,
  addDay,
  addToMenu,
  menuRecipes,
  removeDay,
  removeFromMenu,
  searchMenuOptions,
  setBringing,
  snapshotDishRecipes,
  sortedDays,
  updateDay,
} from './eventLogic';

const SMALL = { fontSize: 'var(--mkh-font-size-small)' };
const TINY = { fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-muted)' };

const STATUS_VARIANT = {
  'Not Started': 'secondary',
  Shopping: 'warning',
  Cooking: 'info',
  Done: 'success',
};

const formatDay = (iso) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'No date yet';

/**
 * "Add a dish or recipe" for one day: a search box that filters as you type,
 * matching any part of a name (every word, any order, accents ignored). What
 * you typed stays until you pick something or clear it.
 */
const MenuPicker = ({ dishes, onPick, dayName }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const options = useMemo(
    () => searchMenuOptions(dishes, query, recipeLabel).slice(0, 60),
    [dishes, query]
  );

  const pick = (option) => {
    if (!option) return;
    const dish =
      option.kind === 'dish'
        ? dishes.find((d) => d.id === option.id)
        : dishes.find((d) => d.recipes.some((r) => r.id === option.id));
    const recipe = option.kind === 'recipe' ? dish?.recipes.find((r) => r.id === option.id) : null;
    onPick(
      option.kind === 'dish'
        ? {
            dishId: option.id,
            label: dish?.name,
            recipeIds: (dish?.recipes || []).map((r) => r.id),
          }
        : { recipeId: option.id, label: recipe ? recipeLabel(recipe) : option.label }
    );
    setQuery('');
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && options[active]) pick(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && (query.trim() !== '' || options.length > 0);
  return (
    <div className="position-relative">
      <InputGroup size="sm">
        <Form.Control
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? `${listId}-${active}` : undefined}
          aria-label={`Add to the ${dayName} menu`}
          placeholder="Search recipes and dishes to add…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        <Button
          variant="outline-secondary"
          disabled={!options[active] || !query.trim()}
          onClick={() => pick(options[active])}
        >
          <Plus size={14} aria-hidden="true" /> Add
        </Button>
      </InputGroup>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="list-unstyled mb-0 position-absolute w-100 shadow-sm"
          style={{
            zIndex: 20,
            maxHeight: '16rem',
            overflowY: 'auto',
            background: 'var(--mkh-surface, #fff)',
            border: '1px solid var(--mkh-border-light)',
            borderRadius: 6,
            marginTop: 2,
          }}
        >
          {options.length === 0 ? (
            <li className="px-2 py-1" style={TINY}>
              Nothing in the library matches “{query.trim()}”.
            </li>
          ) : (
            options.map((o, i) => (
              <li
                key={`${o.kind}:${o.id}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="px-2 py-1"
                style={{
                  ...SMALL,
                  cursor: 'pointer',
                  background:
                    i === active ? 'var(--mkh-surface-hover, rgba(0,0,0,.06))' : undefined,
                  fontWeight: o.kind === 'dish' ? 600 : undefined,
                }}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                {o.label}
                {o.dishName && <span style={TINY}> · {o.dishName}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

const EventCard = ({
  event,
  dishes,
  recipesById,
  onSave,
  onDelete,
  onShop,
  canEdit = true,
  canDelete = true,
  canShare = false,
}) => {
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(event.name);
  const [guests, setGuests] = useState(event.guests || '');
  const [notes, setNotes] = useState(event.notes || '');

  // Dish lines keep their recipes as they stand, for guests (snapshotDishRecipes).
  const save = (next) => onSave({ ...snapshotDishRecipes(next, dishes), id: event.id });
  const saveDetails = async (e) => {
    e.preventDefault();
    const result = await save({
      ...event,
      name: name.trim() || event.name,
      guests: guests.trim(),
      notes: notes.trim(),
    });
    if (result?.success) setEditing(false);
  };

  const days = sortedDays(event);

  return (
    <Card className="shadow-sm" style={{ borderRadius: 'var(--mkh-radius-lg)' }}>
      <Card.Body className="p-3 d-flex flex-column gap-3">
        {editing ? (
          <Form onSubmit={saveDetails} className="d-flex flex-column gap-2">
            <Form.Control
              aria-label="Event name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Form.Control
              aria-label="Guests"
              placeholder="Who's coming"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
            <Form.Control
              as="textarea"
              rows={2}
              aria-label="Notes"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="d-flex gap-2">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button size="sm" variant="light" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </Form>
        ) : (
          <div className="d-flex justify-content-between align-items-start gap-2">
            <div>
              <h2 className="h5 mb-1">{event.name}</h2>
              {event.guests && (
                <div className="d-flex align-items-center gap-1" style={SMALL}>
                  <Users size={14} aria-hidden="true" /> {event.guests}
                </div>
              )}
              {event.notes && (
                <p className="mb-0 text-muted" style={{ ...SMALL, whiteSpace: 'pre-line' }}>
                  {event.notes}
                </p>
              )}
            </div>
            <div className="d-flex gap-1 flex-shrink-0">
              {canShare && (
                <Button
                  size="sm"
                  variant={sharing ? 'primary' : 'outline-secondary'}
                  aria-expanded={sharing}
                  onClick={() => setSharing((s) => !s)}
                >
                  Share
                </Button>
              )}
              {canEdit && (
                <Button size="sm" variant="outline-secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {canDelete && (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  aria-label={`Delete ${event.name}`}
                  onClick={() => onDelete(event)}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </div>
        )}

        {sharing && (
          <ShareControls
            kind="event"
            eventId={event.id}
            what={`plan ${event.name} with you: its days, menu, who's bringing what and its shopping`}
          />
        )}

        {days.map((day) => {
          const menu = menuRecipes(day, dishes, recipesById);
          return (
            <section
              key={day.id}
              aria-label={day.name}
              className="d-flex flex-column gap-2 pt-2"
              style={{ borderTop: '1px solid var(--mkh-border-light)' }}
            >
              <div className="d-flex flex-wrap align-items-center gap-2">
                <CalendarDays size={16} aria-hidden="true" />
                <strong style={SMALL}>{day.name}</strong>
                <span className="text-muted" style={SMALL}>
                  {formatDay(day.date)}
                </span>
                <Badge bg={STATUS_VARIANT[day.status] || 'secondary'} className="ms-auto">
                  {day.status}
                </Badge>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <Form.Control
                  size="sm"
                  type="date"
                  style={{ width: 'auto' }}
                  value={day.date || ''}
                  onChange={(e) => save(updateDay(event, day.id, { date: e.target.value }))}
                  aria-label={`Date of ${day.name}`}
                />
                <Form.Select
                  size="sm"
                  style={{ width: 'auto' }}
                  value={day.status}
                  onChange={(e) => save(updateDay(event, day.id, { status: e.target.value }))}
                  aria-label={`Status of ${day.name}`}
                >
                  {EVENT_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Form.Select>
                {event.days.length > 1 && (
                  <Button
                    size="sm"
                    variant="link"
                    className="text-muted p-0"
                    onClick={() => save(removeDay(event, day.id))}
                  >
                    Remove day
                  </Button>
                )}
              </div>

              {menu.length === 0 ? (
                <span style={TINY}>Nothing on the menu yet.</span>
              ) : (
                <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                  {menu.map(({ label, dish, recipe, line }, index) => (
                    <li
                      key={`${label}-${index}`}
                      className="d-flex align-items-center gap-2"
                      style={SMALL}
                    >
                      <span className="flex-grow-1">
                        {label}
                        {dish && dish.recipes.length > 1 && !(day.menu[index] || {}).recipeId && (
                          <span style={TINY}>
                            {' '}
                            · {label === dish.name ? '' : `${dish.name}, `}any of{' '}
                            {dish.recipes.length} recipes
                          </span>
                        )}
                        {!recipe && <span style={TINY}> · not in the library</span>}
                      </span>
                      {canEdit ? (
                        <Form.Control
                          size="sm"
                          style={{ maxWidth: '9rem' }}
                          defaultValue={line.bringing || ''}
                          placeholder="Who's bringing it"
                          aria-label={`Who's bringing ${label}`}
                          onBlur={(e) =>
                            e.target.value.trim() !== (line.bringing || '') &&
                            save(setBringing(event, day.id, index, e.target.value))
                          }
                        />
                      ) : (
                        line.bringing && <span style={TINY}>{line.bringing} is bringing it</span>
                      )}
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0 text-muted"
                          aria-label={`Take ${label} off the menu`}
                          onClick={() => save(removeFromMenu(event, day.id, index))}
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && (
                <MenuPicker
                  dishes={dishes}
                  dayName={day.name}
                  onPick={(line) => save(addToMenu(event, day.id, line))}
                />
              )}

              {menu.some((m) => m.recipe) && (
                <Button
                  size="sm"
                  variant="outline-primary"
                  className="align-self-start d-flex align-items-center gap-1"
                  onClick={() => onShop(event, [day])}
                >
                  <ShoppingCart size={14} aria-hidden="true" /> Add {day.name} to the shopping list
                </Button>
              )}
            </section>
          );
        })}

        <div
          className="d-flex flex-wrap gap-2 pt-2"
          style={{ borderTop: '1px solid var(--mkh-border-light)' }}
        >
          <Button size="sm" variant="link" className="p-0" onClick={() => save(addDay(event))}>
            <Plus size={14} aria-hidden="true" /> Add a day
          </Button>
          {event.days.length > 1 && (
            <Button
              size="sm"
              variant="link"
              className="p-0 ms-auto"
              onClick={() => onShop(event, event.days)}
            >
              Add the whole event to the shopping list
            </Button>
          )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default EventCard;
