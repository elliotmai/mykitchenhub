// src/pages/Kiosk.jsx
// The fridge-door board.
//
// Read from across the kitchen, by someone holding a pan. That is the whole
// brief, and it is what every choice here answers to: very large type, and the
// thing you came to the fridge to find already on screen.
//
// It used to be strictly read-only and strictly one screen. Both have given a
// little, deliberately. The two list panels scroll, because a list truncated at
// four with "and 6 more" sends you to another device to read the rest — which
// is the failure the board exists to prevent. And the shopping list can be
// edited here, because noticing you are out of milk happens at the fridge, not
// at a desk. Everything else still holds: the week is glanceable without
// touching anything, and no gesture here can destroy a record — ticking off is
// reversible and the only removal is of a line you typed yourself.
//
// It reuses the same hooks as the rest of the app, so it is live for free —
// Firestore pushes a change and the board redraws. There is deliberately no
// polling and no second copy of the expiry arithmetic; `getExpirationLabel`
// and the level colours are the ones the inventory cards already use, so the
// board can never disagree with the page it is summarising.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Settings2,
  AlertTriangle,
  UtensilsCrossed,
  Snowflake,
  ShoppingCart,
  Check,
  Plus,
} from 'lucide-react';

import useWasteAlerts from '../hooks/useWasteAlerts';
import useMealPlan from '../hooks/useMealPlan';
import useShoppingList, { combineShoppingList } from '../hooks/useShoppingList';
import { useShoppingListActions } from '../components/MealPlan/useShoppingListActions';
import useWakeLock from '../hooks/useWakeLock';
import { getExpirationLabel, getExpirationLevel, EXPIRATION_LEVELS } from '../hooks/useInventory';

import './Kiosk.css';

/**
 * How many rows are visible in a list panel before it needs scrolling.
 *
 * Nothing is cut off at this number any more — both list panels scroll, so the
 * whole list is always reachable. It is used only to decide whether to say so:
 * a scrollbar on a wall-mounted tablet, viewed from two metres, is not a
 * visible affordance, so a panel with more than this says "scroll for N more"
 * in words. Roughly what fits a Fire HD 8 panel at these type sizes.
 */
export const KIOSK_VISIBLE_ROWS = 5;

/**
 * Type something onto the list without leaving the fridge.
 *
 * One field and no quantity box. Standing at the fridge the thought is "milk",
 * not "2 litres of milk", and a second field to tab through on a tablet
 * keyboard would cost more than it collects — `addItem` defaults the quantity,
 * and the amount can be corrected later on a device with a real keyboard.
 */
const KioskAddItem = ({ onAdd }) => {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    const result = await onAdd({ name: trimmed });
    setSaving(false);

    if (result?.success) {
      setName('');
      // Focus is kept so a second item can be typed straight away — at a fridge
      // things are remembered in threes, and re-aiming at a small field between
      // each one is the slow part.
      inputRef.current?.focus();
    }
  };

  return (
    <form className="kiosk__add" onSubmit={submit}>
      <input
        ref={inputRef}
        type="text"
        className="kiosk__add-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Add to the list…"
        aria-label="Add an item to the shopping list"
        enterKeyHint="done"
        autoComplete="off"
      />
      <button
        type="submit"
        className="kiosk__add-button"
        disabled={!name.trim() || saving}
        aria-label="Add to the shopping list"
      >
        <Plus size={28} aria-hidden="true" />
      </button>
    </form>
  );
};

/** A ticking clock, because a dark screen and a stopped clock look identical. */
const useClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Ticks on the minute rather than every second: the board shows no seconds,
    // so a per-second render would be 59 repaints an hour for nothing.
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
};

export const Kiosk = () => {
  const { items, expiringItems, loading: alertsLoading } = useWasteAlerts();
  const { weekDays, entriesByDay, shoppingList, loading: planLoading } = useMealPlan();
  const { items: manualItems, loading: shoppingLoading } = useShoppingList();
  const { onAddItem } = useShoppingListActions();
  const { active: screenHeld, supported: wakeLockSupported } = useWakeLock(true);
  const now = useClock();

  // Nothing is sliced off any more; the panel scrolls. The count is only used
  // to say "scroll for N more" out loud, because a scrollbar two metres away
  // is not an affordance anyone can see.
  const eatOverflow = expiringItems.length - KIOSK_VISIBLE_ROWS;
  const loading = alertsLoading || planLoading;

  // Both halves of the list, as one errand list. The board answers a single
  // question on the way out of the door — what do I need to buy — and has no
  // room to explain that one line was computed from Thursday's dinner and
  // another was typed in on Sunday. Anything already ticked off is gone from
  // here, because it is no longer something to pick up.
  const toBuy = combineShoppingList(manualItems, shoppingList);
  const toBuyOverflow = toBuy.length - KIOSK_VISIBLE_ROWS;

  return (
    <div className="kiosk">
      <header className="kiosk__header">
        <div>
          <div className="kiosk__clock">
            {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="kiosk__date">
            {now.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </div>
        </div>

        {/* The way back into the full app. Deliberately small and in a corner:
            it is not what the board is for, and it should not invite a poke. */}
        <Link
          to="/dashboard"
          className="kiosk__exit"
          aria-label="Open the full app"
          title="Open the full app"
        >
          <Settings2 size={28} aria-hidden="true" />
        </Link>
      </header>

      <main className="kiosk__body">
        {/* The week leads, and takes the wider column. Standing at the fridge
            the question is usually "what am I cooking", and the answer is worth
            more space than the list of what is going off. */}
        <section
          className="kiosk__panel kiosk__panel--week"
          aria-labelledby="kiosk-meals"
          data-testid="kiosk-week-panel"
        >
          <h2 id="kiosk-meals" className="kiosk__panel-title">
            <UtensilsCrossed size={32} aria-hidden="true" />
            This week
          </h2>

          {loading ? (
            <p className="kiosk__quiet">Checking the plan…</p>
          ) : (
            <ul className="kiosk__week">
              {weekDays.map((day) => {
                const entries = entriesByDay[day.key] ?? [];
                const className = [
                  'kiosk__day',
                  day.isToday ? 'kiosk__day--today' : '',
                  day.isPast ? 'kiosk__day--past' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <li
                    key={day.key}
                    className={className}
                    aria-current={day.isToday ? 'date' : undefined}
                  >
                    <span className="kiosk__day-when">
                      <span className="kiosk__day-name">{day.label}</span>
                      <span className="kiosk__day-number">{day.dayOfMonth}</span>
                    </span>
                    <span className="kiosk__day-meal">
                      {entries.length > 0
                        ? entries.map((entry, index) => (
                            <span key={entry.id}>
                              {index > 0 && ', '}
                              {/* Only a meal with a recipe behind it is a link.
                                  A meal typed straight onto the plan, or one
                                  scheduled from a delivery before its card was
                                  imported, has nothing to open — and a link
                                  that goes nowhere is worse on a wall display
                                  than no link, because the tap is the only way
                                  to find out. */}
                              {entry.recipeId ? (
                                <Link
                                  to={`/recipes?recipe=${entry.recipeId}`}
                                  className="kiosk__meal-link"
                                >
                                  {entry.recipeName}
                                </Link>
                              ) : (
                                entry.recipeName
                              )}
                            </span>
                          ))
                        : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          className="kiosk__panel kiosk__panel--eat"
          aria-labelledby="kiosk-eat"
          data-testid="kiosk-eat-panel"
        >
          <h2 id="kiosk-eat" className="kiosk__panel-title">
            <AlertTriangle size={24} aria-hidden="true" />
            Eat these first
          </h2>

          {loading ? (
            <p className="kiosk__quiet">Checking the kitchen…</p>
          ) : expiringItems.length === 0 ? (
            <p className="kiosk__all-clear">
              <Snowflake size={28} aria-hidden="true" />
              Nothing about to go off. Nice.
            </p>
          ) : (
            <>
              <ul className="kiosk__items kiosk__scroller" data-testid="kiosk-eat-list">
                {expiringItems.map((item) => {
                  const level = getExpirationLevel(item.expiresAt);
                  return (
                    <li key={item.id} className="kiosk__item">
                      <span
                        className="kiosk__item-dot"
                        style={{ background: EXPIRATION_LEVELS[level]?.background }}
                        aria-hidden="true"
                      />
                      <span className="kiosk__item-name">{item.name}</span>
                      <span className="kiosk__item-when">{getExpirationLabel(item.expiresAt)}</span>
                    </li>
                  );
                })}
              </ul>
              {eatOverflow > 0 && <p className="kiosk__quiet">scroll for {eatOverflow} more</p>}
            </>
          )}
        </section>

        {/* The grocery list: what the week's meals still need, and whatever the
            cook typed in themselves, as one list of errands. Both halves,
            because a corner showing only the ad-hoc items would be actively
            misleading about what needs buying.

            This is the panel that gained hands. A typed row can be ticked off
            or taken away; a derived row can only be read, because there is no
            document behind it — it is a fact about this week's meals minus the
            kitchen, and it goes away by itself when the ingredient is in the
            fridge. Giving it a tick box would mean writing a document to record
            that a computed line had been dealt with, and then the same list
            would be true in two places. */}
        <section
          className="kiosk__panel kiosk__panel--shopping"
          aria-labelledby="kiosk-shopping"
          data-testid="kiosk-shopping"
        >
          <h2 id="kiosk-shopping" className="kiosk__panel-title">
            <ShoppingCart size={24} aria-hidden="true" />
            Shopping list
          </h2>

          {loading || shoppingLoading ? (
            <p className="kiosk__quiet">Checking the list…</p>
          ) : (
            <>
              {toBuy.length === 0 ? (
                <p className="kiosk__all-clear kiosk__all-clear--list">
                  <Check size={28} aria-hidden="true" />
                  Nothing to pick up.
                </p>
              ) : (
                <ul
                  className="kiosk__items kiosk__shopping kiosk__scroller"
                  data-testid="kiosk-shopping-list"
                >
                  {toBuy.map((row) => (
                    <li key={row.key} className="kiosk__item kiosk__item--buy">
                      <span className="kiosk__item-name">{row.name}</span>
                      {row.amount && <span className="kiosk__item-when">{row.amount}</span>}
                    </li>
                  ))}
                </ul>
              )}

              {toBuyOverflow > 0 && <p className="kiosk__quiet">scroll for {toBuyOverflow} more</p>}

              {/* Always on screen, empty list or not — the commonest reason to
                  touch this panel is to put something on it. */}
              <KioskAddItem onAdd={onAddItem} />
            </>
          )}
        </section>
      </main>

      <footer className="kiosk__footer">
        <span>
          {items.length} item{items.length === 1 ? '' : 's'} in the kitchen
        </span>
        {/* Only worth saying when the screen is NOT being held: a board that
            goes dark and does not explain why looks like a broken tablet. */}
        {!screenHeld && (
          <span className="kiosk__warn">
            {wakeLockSupported
              ? 'Screen may sleep — set the display timeout to Never'
              : 'This browser cannot hold the screen on — set the display timeout to Never'}
          </span>
        )}
      </footer>
    </div>
  );
};

export default Kiosk;
