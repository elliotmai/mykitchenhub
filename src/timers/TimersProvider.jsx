// src/timers/TimersProvider.jsx
// The household's cooking timers, everywhere in the app.
//
// Timers live in kitchen.timers, by end time, shared with the fridge board and
// every other device in the household (src/backend/timers.js). This provider
// keeps the list fresh (Realtime, plus a refetch on wake and every half
// minute in case a message was missed), ticks once a second while any exist,
// and rings for every finished timer until someone stops it: a chime, a buzz,
// a system notification if allowed, and an alert on screen.
//
// Inside Hive (KitchenHub open in Hive's frame) Hive does the ringing, so the
// same device doesn't chime twice; the alert still shows here.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '../hooks/useAuth';
import { addTimer, listTimers, removeTimer, watchTimers } from '../backend/timers';
import { fromRow, newTimerRow, ringing, sortTimers, timerForKey } from './timerLogic';
import { askToNotify, notifyDone, startRinging, unlockAudio } from './ringer';
import TimerAlarm from './TimerAlarm';
import TimerTray from './TimerTray';
import './timers.css';

const TimersContext = createContext(null);
const REFRESH_MS = 30000;

/** Is this page inside Hive's frame (Hive rings there)? */
export const insideHive = () => {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return true; // a cross-origin parent: framed
  }
};

/** The timers, or null outside a TimersProvider (a screen rendered on its own). */
export const useOptionalTimers = () => useContext(TimersContext);

export const useTimers = () => {
  const context = useContext(TimersContext);
  if (!context) throw new Error('useTimers must be used within a TimersProvider');
  return context;
};

export function TimersProvider({ children, now: fixedNow }) {
  const { user } = useAuth();
  const [timers, setTimers] = useState([]);
  const [error, setError] = useState(null);
  const [clock, setClock] = useState(() => Date.now());
  const now = fixedNow ?? clock;
  const signedIn = Boolean(user?.uid);

  const reload = useCallback(async () => {
    try {
      const rows = await listTimers();
      setTimers(rows.map(fromRow));
      setError(null);
    } catch (err) {
      setError('Could not load the kitchen timers.');
    }
  }, []);

  // Load, then keep up: Realtime, waking up, and a slow safety refetch.
  useEffect(() => {
    if (!signedIn) {
      setTimers([]);
      return undefined;
    }
    reload();
    const unwatch = watchTimers(reload);
    const id = setInterval(reload, REFRESH_MS);
    const wake = () => {
      if (!document.hidden) reload();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      unwatch();
      clearInterval(id);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [signedIn, reload]);

  // The first tap anywhere makes sound possible (browsers' autoplay rule).
  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
  }, []);

  // Tick once a second while any timer exists.
  const any = timers.length > 0;
  useEffect(() => {
    if (!any || fixedNow !== undefined) return undefined;
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [any, fixedNow]);

  const sorted = useMemo(() => sortTimers(timers, now), [timers, now]);
  const done = useMemo(() => ringing(timers, now), [timers, now]);
  const ringingIds = done.map((t) => t.id).join(',');

  // Ring while anything is done; notify once per timer.
  const notified = useRef(new Set());
  useEffect(() => {
    if (!ringingIds) return undefined;
    const quiet = insideHive();
    for (const t of done) {
      if (!notified.current.has(t.id)) {
        notified.current.add(t.id);
        if (!quiet) notifyDone(t);
      }
    }
    return quiet ? undefined : startRinging();
    // `done` is read for its ids, which ringingIds already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringingIds]);

  const start = useCallback(async ({ label, minutes, seconds, key }) => {
    unlockAudio();
    askToNotify();
    const row = newTimerRow({ label, minutes, seconds, key });
    if (!row) return { success: false, error: 'Pick a time between a second and a day.' };
    const temp = fromRow({ ...row, id: `pending-${Date.now()}` });
    setTimers((list) => [...list, temp]);
    try {
      const saved = await addTimer(row);
      setTimers((list) => [...list.filter((t) => t.id !== temp.id), fromRow(saved)]);
      return { success: true, timer: fromRow(saved) };
    } catch (err) {
      setTimers((list) => list.filter((t) => t.id !== temp.id));
      return { success: false, error: 'Could not start that timer. Check your connection.' };
    }
  }, []);

  const stop = useCallback(
    async (id) => {
      setTimers((list) => list.filter((t) => t.id !== id));
      try {
        await removeTimer(id);
        return { success: true };
      } catch (err) {
        reload();
        return { success: false, error: 'Could not stop that timer. Check your connection.' };
      }
    },
    [reload]
  );

  const stopAll = useCallback(async () => {
    await Promise.all(done.map((t) => stop(t.id)));
  }, [done, stop]);

  /** A recipe step's button: start its timer, or stop the one it started. */
  const toggle = useCallback(
    (key, minutes, label) => {
      const existing = timerForKey(timers, key);
      return existing ? stop(existing.id) : start({ key, minutes, label });
    },
    [timers, start, stop]
  );

  const value = useMemo(
    () => ({ timers: sorted, ringing: done, now, error, start, stop, stopAll, toggle, reload }),
    [sorted, done, now, error, start, stop, stopAll, toggle, reload]
  );

  return (
    <TimersContext.Provider value={value}>
      {children}
      {signedIn && (
        <>
          <TimerTray />
          <TimerAlarm />
        </>
      )}
    </TimersContext.Provider>
  );
}

export default TimersProvider;
