// src/hooks/useCookingHold.js
// While cook mode is up, nothing sends the screen anywhere else.
//
// Two things can take a tablet away from a recipe mid-cook:
//
//  - KitchenHub's own kiosk return (useIdleReturn), on a tablet set up as the
//    fridge display. Cook mode holds it.
//
//  - Hive, when KitchenHub is open inside it: after 15 minutes without a touch
//    on Hive itself it goes back to Fridge Board. Taps inside KitchenHub's
//    frame never reach Hive, so it can't see that anyone is cooking. So cook
//    mode tells it, { type: 'hive:busy', busy: true }, and repeats that every
//    minute while it is up. Hive treats a busy app as in use, and lets the
//    claim lapse a few minutes after the last one, so a tablet that loses the
//    page mid-cook still finds its way back to the board. On the way out it
//    says { busy: false }.
//
// The message carries nothing private, and Hive checks that it came from the
// frame it opened, so it goes to whatever page is hosting us.

import { useEffect } from 'react';
import { holdIdleReturn } from './useIdleReturn';

/** How often cook mode reminds Hive that it is still cooking. */
export const BUSY_EVERY_MS = 60_000;

const inFrame = () => {
  try {
    return window.parent && window.parent !== window;
  } catch {
    return true;
  }
};

const tellHive = (busy) => {
  if (!inFrame()) return;
  try {
    window.parent.postMessage({ type: 'hive:busy', v: 1, busy }, '*');
  } catch {
    // No host to tell: nothing to hold off.
  }
};

export const useCookingHold = () => {
  useEffect(() => {
    const release = holdIdleReturn();
    tellHive(true);
    const id = setInterval(() => tellHive(true), BUSY_EVERY_MS);
    return () => {
      clearInterval(id);
      release();
      tellHive(false);
    };
  }, []);
};

export default useCookingHold;
