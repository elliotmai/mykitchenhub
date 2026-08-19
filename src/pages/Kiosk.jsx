// src/pages/Kiosk.jsx
// The fridge-door board.
//
// Read from across the kitchen, by someone holding a pan. That is the whole
// brief, and it is what every choice here answers to: very large type, a
// handful of things rather than everything, no scrolling, and no state that a
// passing elbow can put wrong.
//
// It reuses the same hooks as the rest of the app, so it is live for free —
// Firestore pushes a change and the board redraws. There is deliberately no
// polling and no second copy of the expiry arithmetic; `getExpirationLabel`
// and the level colours are the ones the inventory cards already use, so the
// board can never disagree with the page it is summarising.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, AlertTriangle, UtensilsCrossed, Snowflake } from 'lucide-react';

import useWasteAlerts from '../hooks/useWasteAlerts';
import useMealPlan from '../hooks/useMealPlan';
import useWakeLock from '../hooks/useWakeLock';
import { getExpirationLabel, getExpirationLevel, EXPIRATION_LEVELS } from '../hooks/useInventory';

import './Kiosk.css';

/** How many expiring items fit on the board before it stops being glanceable. */
export const KIOSK_ITEM_LIMIT = 6;

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
  const { weekDays, entriesByDay, loading: planLoading } = useMealPlan();
  const { active: screenHeld, supported: wakeLockSupported } = useWakeLock(true);
  const now = useClock();

  const today = weekDays.find((day) => day.isToday);
  const todayEntries = today ? (entriesByDay[today.key] ?? []) : [];
  const upcoming = weekDays.filter((day) => !day.isPast && !day.isToday).slice(0, 3);

  const shown = expiringItems.slice(0, KIOSK_ITEM_LIMIT);
  const overflow = expiringItems.length - shown.length;
  const loading = alertsLoading || planLoading;

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
        <section className="kiosk__panel kiosk__panel--eat" aria-labelledby="kiosk-eat">
          <h2 id="kiosk-eat" className="kiosk__panel-title">
            <AlertTriangle size={32} aria-hidden="true" />
            Eat these first
          </h2>

          {loading ? (
            <p className="kiosk__quiet">Checking the kitchen…</p>
          ) : shown.length === 0 ? (
            <p className="kiosk__all-clear">
              <Snowflake size={40} aria-hidden="true" />
              Nothing about to go off. Nice.
            </p>
          ) : (
            <>
              <ul className="kiosk__items">
                {shown.map((item) => {
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
              {overflow > 0 && (
                <p className="kiosk__quiet">and {overflow} more on the Waste Alerts page</p>
              )}
            </>
          )}
        </section>

        <section className="kiosk__panel" aria-labelledby="kiosk-meals">
          <h2 id="kiosk-meals" className="kiosk__panel-title">
            <UtensilsCrossed size={32} aria-hidden="true" />
            Tonight
          </h2>

          {loading ? (
            <p className="kiosk__quiet">Checking the plan…</p>
          ) : todayEntries.length === 0 ? (
            <p className="kiosk__quiet kiosk__quiet--big">Nothing planned for today</p>
          ) : (
            <ul className="kiosk__meals">
              {todayEntries.map((entry) => (
                <li key={entry.id} className="kiosk__meal">
                  {entry.recipeName}
                </li>
              ))}
            </ul>
          )}

          <h3 className="kiosk__subtitle">Coming up</h3>
          <ul className="kiosk__upcoming">
            {upcoming.map((day) => {
              const entries = entriesByDay[day.key] ?? [];
              return (
                <li key={day.key} className="kiosk__upcoming-day">
                  <span className="kiosk__upcoming-label">{day.label}</span>
                  <span className="kiosk__upcoming-meal">
                    {entries.length > 0 ? entries.map((e) => e.recipeName).join(', ') : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
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
