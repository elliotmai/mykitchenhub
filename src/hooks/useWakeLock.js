// src/hooks/useWakeLock.js
// Keeps the screen on while the kiosk board is showing.
//
// A tablet on a fridge door is useless the moment it sleeps: nobody walking
// past with their hands full is going to wake it, and a board you have to
// touch to read is not a board.
//
// The Screen Wake Lock API is the right way to ask, but it is not everywhere —
// Fire OS's Silk is Chromium, though an older one, and the API needs a secure
// context. So this reports whether it actually got the lock; the kiosk screen
// tells the cook to set the device's own display timeout when it did not,
// rather than silently letting the screen go dark.
//
// The lock is dropped by the browser whenever the tab is hidden, which is why
// it is re-acquired on visibilitychange rather than only on mount.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Is the API present at all? */
export const isWakeLockSupported = () =>
  typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/**
 * Holds a screen wake lock for as long as the component is mounted.
 *
 * @param {boolean} [enabled] set false to release it (leaving the kiosk)
 * @returns {{ active: boolean, supported: boolean, error: string|null }}
 */
export const useWakeLock = (enabled = true) => {
  const sentinelRef = useRef(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  const supported = isWakeLockSupported();

  const release = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {
      // Already gone — the browser drops it on its own when the tab hides.
    }
  }, []);

  const acquire = useCallback(async () => {
    if (!supported || sentinelRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setActive(true);
      setError(null);
      // The browser releases it for its own reasons (tab hidden, battery
      // saver). Reflect that rather than claiming the screen is still held.
      sentinel.addEventListener?.('release', () => {
        sentinelRef.current = null;
        setActive(false);
      });
    } catch (err) {
      // A refusal is normal — battery saver, an insecure origin, an older
      // Chromium. It is not worth an error screen, only an honest flag.
      setActive(false);
      setError(err?.message ?? 'Wake lock refused');
    }
  }, [supported]);

  useEffect(() => {
    if (!enabled) {
      release();
      return undefined;
    }

    acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, [enabled, acquire, release]);

  return { active, supported, error };
};

export default useWakeLock;
