import { Workbox } from 'workbox-window';

import { isApplyingUpdate } from './utils/appUpdate';

// How often to check for updates (in milliseconds)
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * How long a worker must still be waiting before we call it an update.
 *
 * A first install passes through `waiting` on its way to activating, because
 * there is no controller to wait for — so `registration.waiting` is briefly
 * set on a browser that has never seen the app. Announcing that put an
 * "Update Available" card in front of people who had just arrived. Re-reading
 * the registration a moment later tells the two apart: a real update is still
 * waiting, a first install has moved on.
 */
const WAITING_SETTLE_MS = 200;

/**
 * Announce a waiting worker to the app, but only once per worker.
 *
 * `registration.waiting` is read on every update check, so without the
 * `announced` guard a dismissed prompt would spring straight back the next
 * time the tablet woke up. A genuinely newer build is a different
 * ServiceWorker object, so it still gets through.
 */
const makeAnnouncer = (onUpdate) => {
  let announced = null;

  return (registration) => {
    const waiting = registration?.waiting;
    if (!waiting || waiting === announced) return;

    // An update replaces the worker currently running the page. With no
    // controller there is nothing to replace — this is a first install, and
    // there is no old version for the user to be updated away from.
    if (!navigator.serviceWorker.controller) return;

    setTimeout(() => {
      if (registration.waiting !== waiting || waiting === announced) return;
      announced = waiting;
      console.log('New version installed and waiting to take over');
      onUpdate?.(waiting);
    }, WAITING_SETTLE_MS);
  };
};

export function register(config) {
  if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
    if (publicUrl.origin !== window.location.origin) {
      return;
    }

    const registerWorker = () => {
      const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

      const wb = new Workbox(swUrl);

      // Store the workbox instance for external access
      window.__WB = wb;

      const announce = makeAnnouncer(config?.onUpdate);

      // Called when the service worker is first installed
      wb.addEventListener('installed', (event) => {
        if (!event.isUpdate) {
          console.log('Service worker installed for the first time');
          config?.onSuccess?.(wb);
        } else {
          console.log('Service worker updated');
        }
      });

      // Called when a new service worker takes control of this page.
      //
      // Only an update is worth reloading for. The worker calls clientsClaim(),
      // so the very first one to activate also fires this — and reloading there
      // would throw away a page that had just finished loading, on everyone's
      // first visit, for no reason. A controller existing beforehand is what
      // separates the two, and unlike workbox-window's `isUpdate` flag it is
      // plain browser state rather than a sixty-second heuristic.
      const hadController = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) {
          console.log('Service worker took control for the first time');
          return;
        }
        // applyUpdate() asked for this controller change and still has caches
        // to clear before it reloads; reloading here would cut that short.
        if (isApplyingUpdate()) return;

        console.log('A new service worker took control; reloading');
        window.location.reload();
      });

      // Handle registration errors
      wb.register()
        .then((registration) => {
          console.log('Service worker registered:', registration);
          if (!registration) return;

          // A worker can already be waiting before this page even loaded —
          // installed by a previous visit that was closed before it took over.
          announce(registration);

          // Watch the registration itself rather than workbox-window's
          // lifecycle events.
          //
          // workbox-window classifies any update found more than 60 seconds
          // after register() as "external" (Workbox.ts, _onUpdateFound), and
          // then *removes its own updatefound listener*. Every update on a page
          // left open — which is every update on the fridge tablet — arrives
          // via the poll below, long past that cutoff. So its events fire at
          // most once and carry flags that say the new worker is not ours.
          // `registration.waiting` has no such opinion.
          const watchInstalling = () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed') announce(registration);
            });
          };
          registration.addEventListener('updatefound', watchInstalling);
          watchInstalling();

          const checkForUpdate = (reason) => {
            console.log(`Checking for service worker updates (${reason})...`);
            registration
              .update()
              .then(() => announce(registration))
              .catch((err) => {
                console.log('Update check failed:', err);
              });
          };

          setInterval(() => checkForUpdate('hourly'), UPDATE_CHECK_INTERVAL);

          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') checkForUpdate('visible');
          });

          window.addEventListener('online', () => checkForUpdate('online'));
        })
        .catch((error) => {
          console.error('Service worker registration failed:', error);
        });
    };

    // Register now if the page has already finished loading — roadmap 9.1.
    //
    // This used to be an unconditional `addEventListener('load', ...)`. App.jsx
    // calls register() from a useEffect, and React schedules effects after
    // paint, so by the time this ran `load` had usually already fired. The
    // listener was then attached to an event that would never happen again and
    // the service worker was never registered at all — no precache, no offline,
    // and an install prompt for an app that could not run offline. Nothing
    // visibly broke, which is why it lasted.
    if (document.readyState === 'complete') {
      registerWorker();
    } else {
      window.addEventListener('load', registerWorker, { once: true });
    }
  }
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error('Service worker unregistration failed:', error.message);
      });
  }
}

/**
 * Check for updates manually
 * Returns a promise that resolves when the check is complete
 */
export async function checkForUpdates() {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    return registration.update();
  }
  return Promise.resolve();
}
