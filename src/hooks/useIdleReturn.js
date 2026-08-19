// src/hooks/useIdleReturn.js
// Sends a wandering kiosk back to its board.
//
// The fridge tablet is shared and nobody signs out of it. Someone taps through
// to add an item, gets called away, and the screen sits on a half-filled form
// until the next person finds it. Worse, it sits on whatever page they left,
// so the board everyone relies on is simply not there.
//
// So: after a few quiet minutes, go back. Any real interaction resets the
// countdown, and it does not fire while the cook is actually typing.

import { useEffect, useRef } from 'react';

/** Quiet time before the kiosk goes back to its board. */
export const DEFAULT_IDLE_MS = 120_000;

/** Events that count as somebody being there. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

/**
 * Calls `onIdle` after `idleMs` without interaction.
 *
 * @param {() => void} onIdle
 * @param {object}  [options]
 * @param {number}  [options.idleMs]
 * @param {boolean} [options.enabled]
 */
export const useIdleReturn = (onIdle, { idleMs = DEFAULT_IDLE_MS, enabled = true } = {}) => {
  // Held in a ref so a re-rendered callback does not restart the timer, which
  // would keep pushing the deadline back and mean it never fires at all.
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return undefined;

    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current?.(), idleMs);
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [idleMs, enabled]);
};

export default useIdleReturn;
