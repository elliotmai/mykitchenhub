// src/events/EventCard.jsx
// One event: its guests and notes, and each of its days with a date, a
// status and a menu of dishes and recipes. A day's menu (or the whole
// event's) goes onto the shopping list by item, no amounts, each line in the
// store it's usually bought at.

import React, { useState } from 'react';
import { Badge, Button, Card, Form, InputGroup } from 'react-bootstrap';
import { CalendarDays, Plus, ShoppingCart, Trash2, Users, X } from 'lucide-react';

import { recipeLabel } from '../components/MealPlan/ScheduleMealModal';
import {
  EVENT_STATUSES,
  addDay,
  addToMenu,
  menuRecipes,
  removeDay,
  removeFromMenu,
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

/** "Add a dish or recipe" for one day. */
const MenuPicker = ({ dishes, onPick, dayName }) => {
  const [value, setValue] = useState('');
  const pick = (event) => {
    event.preventDefault();
    if (!value) return;
    const [kind, id] = value.split(':');
    const dish = dishes.find((d) =>
      kind === 'dish' ? d.id === id : d.recipes.some((r) => r.id === id)
    );
    const recipe = kind === 'recipe' ? dish?.recipes.find((r) => r.id === id) : null;
    onPick(
      kind === 'dish'
        ? { dishId: id, label: dish?.name }
        : { recipeId: id, label: recipe ? recipeLabel(recipe) : '' }
    );
    setValue('');
  };
  return (
    <Form onSubmit={pick}>
      <InputGroup size="sm">
        <Form.Select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`Add to the ${dayName} menu`}
        >
          <option value="">Add a dish or recipe…</option>
          {dishes.map((dish) =>
            dish.recipes.length === 1 ? (
              <option key={dish.id} value={`recipe:${dish.recipes[0].id}`}>
                {recipeLabel(dish.recipes[0])}
              </option>
            ) : (
              <optgroup key={dish.id} label={dish.name}>
                <option value={`dish:${dish.id}`}>{dish.name} (any recipe)</option>
                {dish.recipes.map((r) => (
                  <option key={r.id} value={`recipe:${r.id}`}>
                    {recipeLabel(r)}
                  </option>
                ))}
              </optgroup>
            )
          )}
        </Form.Select>
        <Button type="submit" variant="outline-secondary" disabled={!value}>
          <Plus size={14} aria-hidden="true" /> Add
        </Button>
      </InputGroup>
    </Form>
  );
};

const EventCard = ({ event, dishes, recipesById, onSave, onDelete, onShop }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(event.name);
  const [guests, setGuests] = useState(event.guests || '');
  const [notes, setNotes] = useState(event.notes || '');

  const save = (next) => onSave({ ...next, id: event.id });
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
              <Button size="sm" variant="outline-secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline-secondary"
                aria-label={`Delete ${event.name}`}
                onClick={() => onDelete(event)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
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
                  {menu.map(({ label, dish, recipe }, index) => (
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
                            · {dish.name}, any of {dish.recipes.length}
                          </span>
                        )}
                        {!recipe && <span style={TINY}> · not in the library</span>}
                      </span>
                      <Button
                        size="sm"
                        variant="link"
                        className="p-0 text-muted"
                        aria-label={`Take ${label} off the menu`}
                        onClick={() => save(removeFromMenu(event, day.id, index))}
                      >
                        <X size={14} />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <MenuPicker
                dishes={dishes}
                dayName={day.name}
                onPick={(line) => save(addToMenu(event, day.id, line))}
              />

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
