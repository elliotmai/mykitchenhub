// src/utils/kioskMode.js
// Whether THIS device is the one on the fridge door.
//
// Per-device, not per-account: the tablet on the fridge and the phone in your
// pocket are the same signed-in cook, and only one of them should be dragged
// back to the board when it is left alone. So localStorage, not Firestore.

/** localStorage key. Namespaced like the What's New marker beside it. */
export const KIOSK_MODE_KEY = 'mykitchenhub.kioskMode';

/** Is this device set up as a fridge display? */
export const isKioskDevice = () => {
  try {
    return window.localStorage.getItem(KIOSK_MODE_KEY) === 'true';
  } catch {
    // Private mode, or storage disabled. Not a kiosk, then.
    return false;
  }
};

/** Turn fridge-display behaviour on or off for this device. */
export const setKioskDevice = (enabled) => {
  try {
    if (enabled) window.localStorage.setItem(KIOSK_MODE_KEY, 'true');
    else window.localStorage.removeItem(KIOSK_MODE_KEY);
  } catch {
    // Nothing to be done, and nothing worth interrupting the cook over.
  }
};

export default isKioskDevice;
