// src/pages/Events.jsx
// Meal planning by events (Thanksgiving, a birthday, game night), alongside
// the week-by-week meal plan. See src/events/eventLogic.js.

import React, { useMemo, useState } from 'react';
import { Alert, Button, Col, Form, Row, Spinner } from 'react-bootstrap';
import { CalendarHeart, Plus } from 'lucide-react';

import useRecipes from '../hooks/useRecipes';
import useShoppingList from '../hooks/useShoppingList';
import useDishes from '../dishes/useDishes';
import useStores from '../stores/useStores';
import useEvents from '../events/useEvents';
import EventCard from '../events/EventCard';
import { shoppingLines, sortEvents } from '../events/eventLogic';
import ConfirmModal from '../components/Common/ConfirmModal';
import { useToast } from '../components/Common';

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const Events = () => {
  const { events, loading, error, create, save, remove } = useEvents();
  const { recipes } = useRecipes();
  const { dishes } = useDishes(recipes);
  const { items, addItem } = useShoppingList();
  const { usualStore } = useStores();
  const { showError, showSuccess } = useToast();

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [guests, setGuests] = useState('');
  const [adding, setAdding] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const recipesById = useMemo(() => Object.fromEntries(recipes.map((r) => [r.id, r])), [recipes]);
  const { upcoming, past } = useMemo(() => sortEvents(events, todayKey()), [events]);

  const report = (result) => {
    if (result && !result.success) showError(result.error);
    return result;
  };

  const submit = async (e) => {
    e.preventDefault();
    setAdding(true);
    const result = report(await create({ name, date: date || null, guests }));
    setAdding(false);
    if (result?.success) {
      setName('');
      setDate('');
      setGuests('');
    }
  };

  const shop = async (event, days) => {
    const lines = shoppingLines(days, dishes, recipesById, items, event.id);
    if (!lines.length) {
      showSuccess('Everything on that menu is already on the shopping list.');
      return;
    }
    let added = 0;
    for (const line of lines) {
      const store = usualStore(line.name);
      const result = await addItem({ ...line, ...(store ? { store } : {}) });
      if (result.success) added += 1;
    }
    if (added === lines.length)
      showSuccess(`Added ${added} item${added === 1 ? '' : 's'} to the shopping list.`);
    else showError(`Added ${added} of ${lines.length}; the rest could not be saved.`);
  };

  const cards = (list) =>
    list.map((event) => (
      <EventCard
        key={event.id}
        event={event}
        dishes={dishes}
        recipesById={recipesById}
        onSave={(next) => save(next).then(report)}
        onDelete={setDeleting}
        onShop={shop}
      />
    ));

  return (
    <div className="events-page d-flex flex-column gap-3">
      <div>
        <h1 className="h3 mb-0">Events</h1>
        <small className="text-muted">
          Plan the menu for a holiday or a get-together, then shop for it in one go.
        </small>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Form onSubmit={submit} aria-label="New event">
        <Row className="g-2 align-items-end">
          <Col xs={12} md={4}>
            <Form.Label htmlFor="event-name" className="small mb-1">
              Event
            </Form.Label>
            <Form.Control
              id="event-name"
              placeholder="Thanksgiving"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label htmlFor="event-date" className="small mb-1">
              Date (optional)
            </Form.Label>
            <Form.Control
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Col>
          <Col xs={6} md={3}>
            <Form.Label htmlFor="event-guests" className="small mb-1">
              Guests (optional)
            </Form.Label>
            <Form.Control
              id="event-guests"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </Col>
          <Col xs={12} md={2}>
            <Button
              type="submit"
              className="w-100 d-flex align-items-center justify-content-center gap-1"
              disabled={!name.trim() || adding}
            >
              <Plus size={16} aria-hidden="true" /> Add event
            </Button>
          </Col>
        </Row>
      </Form>

      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner size="sm" /> Loading events…
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <div className="text-center text-muted py-5">
          <CalendarHeart size={48} className="mb-2 opacity-50" aria-hidden="true" />
          <p className="mb-0">No events yet. Add one above to start its menu.</p>
        </div>
      ) : (
        <>
          {upcoming.length === 0 ? (
            <p className="text-muted mb-0">Nothing coming up.</p>
          ) : (
            <div className="d-flex flex-column gap-3">{cards(upcoming)}</div>
          )}
          {past.length > 0 && (
            <div>
              <Button
                variant="link"
                className="px-0"
                aria-expanded={showPast}
                onClick={() => setShowPast((s) => !s)}
              >
                {showPast ? 'Hide' : 'Show'} past events ({past.length})
              </Button>
              {showPast && <div className="d-flex flex-column gap-3 mt-2">{cards(past)}</div>}
            </div>
          )}
        </>
      )}

      <ConfirmModal
        show={Boolean(deleting)}
        onHide={() => setDeleting(null)}
        onConfirm={async () => {
          report(await remove(deleting.id));
          setDeleting(null);
        }}
        variant="danger"
        title="Delete event"
        message={
          deleting ? `Delete "${deleting.name}" and its menu? Recipes stay in the library.` : ''
        }
        confirmText="Delete"
      />
    </div>
  );
};

export default Events;
