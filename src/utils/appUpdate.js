// src/utils/appUpdate.js
// Actually applying a waiting service worker, rather than asking it nicely.
//
// The old path was `workbox.messageSkipWaiting()` and a reload triggered from
// workbox-window's `controlling` event. It looked right and it did nothing on
// the one device that matters most — the tablet on the fridge — because
// workbox-window decides whether an update is "ours" or "external" with this
// heuristic (Workbox.ts, `_onUpdateFound`):
//
//     performance.now() > this._registrationTime + 60_000  →  external
//
// Every update on a long-lived page is found by the hourly poll, by
// `visibilitychange`, or by coming back online — all of them minutes or days
// after registration, so all of them are classified external. For an external
// worker workbox-window never sets `_sw` to the new worker and it *removes its
// own `updatefound` listener*, so:
//
//   - the `waiting` event still fires, which is why the popup appeared;
//   - `controlling` then reports `isExternal`, and the reload was gated on
//     flags that branch no longer sets;
//   - and no further update is ever noticed by that page again.
//
// So this module does not ask workbox anything. `registration.waiting` and
// `navigator.serviceWorker.controller` are plain browser state with no
// heuristics in front of them, and that is what it drives.
//
// The other half of the fix is that the last step is unconditional. Whatever
// the service worker does or fails to do, the page reloads — a reload that
// turns out to be unnecessary costs a second, and is infinitely better than a
// button that silently does nothing.

/** The message the service worker's own `message` handler listens for. */
export const SKIP_WAITING = 'SKIP_WAITING';

/** How long to wait for the new worker to take control before reloading anyway. */
export const CONTROL_TIMEOUT_MS = 6_000;

/**
 * Caches that belong to the *new* build and must survive the clear-out.
 *
 * Both are written by the incoming service worker while it installs, which has
 * already happened by the time it is waiting — so they hold the new content,
 * not the stale content we are trying to be rid of. Deleting them would take
 * the app offline until the *next* release installed, which on a fridge tablet
 * with patchy wifi is a worse bug than the one being fixed.
 *
 * Everything else is runtime cache the app fills opportunistically, and all of
 * it refills from the network on the next request.
 */
const KEEP_CACHE_PREFIXES = ['workbox-precache', 'offline-fallback'];

const isDisposable = (cacheName) =>
  !KEEP_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix));

// Set for the length of an update we are driving ourselves.
//
// The registration module reloads when the controller changes underneath the
// page — an update applied in another tab, say. That is right in general and
// wrong in the middle of `applyUpdate`, which asks for the controller change
// itself and still has caches to clear before it reloads. Without this flag
// that reload lands during the clear-out and leaves it half done.
let applying = false;

/** Are we part-way through applying an update in this page? */
export const isApplyingUpdate = () => applying;

/** Progress stages, in the order they happen. The UI renders these. */
export const UPDATE_STAGES = {
  activating: 'Switching to the new version…',
  clearing: 'Clearing out the old files…',
  reloading: 'Reloading…',
};

/**
 * Empty every runtime cache, keeping the two the new worker just built.
 *
 * Never rejects: a cache that will not delete is not a reason to abandon an
 * update half-applied. Returns the names it removed, which is what the tests
 * assert on.
 */
export const clearRuntimeCaches = async () => {
  if (typeof caches === 'undefined') return [];

  try {
    const names = await caches.keys();
    const disposable = names.filter(isDisposable);
    await Promise.all(disposable.map((name) => caches.delete(name).catch(() => false)));
    return disposable;
  } catch {
    return [];
  }
};

/**
 * Resolve when the new worker takes control, or when `timeoutMs` runs out.
 *
 * Resolves either way — the caller reloads regardless, and the only thing the
 * distinction changes is how long we are willing to wait first.
 */
const waitForControlChange = (timeoutMs) =>
  new Promise((resolve) => {
    if (!('serviceWorker' in navigator)) {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (tookControl) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(tookControl);
    };

    const onChange = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);

    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });

/** Is there a new build installed and waiting to take over? */
export const getWaitingWorker = async () => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.waiting ?? null;
  } catch {
    return null;
  }
};

/**
 * Apply a waiting update: activate it, clear the stale caches, reload.
 *
 * @param {object}   options
 * @param {function} options.onStage  - called with each key of UPDATE_STAGES
 * @param {number}   options.timeoutMs
 * @param {function} options.reload   - injected so tests do not navigate
 * @returns {Promise<{tookControl: boolean, cleared: string[]}>}
 */
export const applyUpdate = async ({
  onStage = () => {},
  timeoutMs = CONTROL_TIMEOUT_MS,
  reload = () => window.location.reload(),
} = {}) => {
  applying = true;
  onStage('activating');

  const waiting = await getWaitingWorker();
  let tookControl = false;

  if (waiting) {
    // Start listening *before* posting, or a worker that activates instantly
    // fires controllerchange into a page that is not yet listening for it.
    const controlled = waitForControlChange(timeoutMs);
    try {
      waiting.postMessage({ type: SKIP_WAITING });
    } catch {
      // A worker that has already gone redundant throws here. The reload below
      // still picks up whatever did activate.
    }
    tookControl = await controlled;
  }

  onStage('clearing');
  const cleared = await clearRuntimeCaches();

  onStage('reloading');
  reload();

  return { tookControl, cleared };
};

export default applyUpdate;
