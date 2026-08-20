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
 * How long to spend looking for a newer build before applying what is waiting.
 *
 * Generous, because a fridge tablet on far-end-of-the-house wifi is the case
 * this exists for, and the cost of giving up early is the two-tap update it is
 * meant to remove. It is not a stall: the card is on screen saying what it is
 * doing for every second of it.
 */
export const REFRESH_TIMEOUT_MS = 8_000;

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
  checking: 'Checking for the newest version…',
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

/* --------------------------------------------------------------------------
   Noticing an update that did not take

   `applyUpdate` reloads whatever happens, which is the right call — a button
   that silently does nothing is the bug this module exists to fix. But it has
   a failure mode of its own: if the new worker never activates, the reload
   lands on the *same* build, that worker is still waiting, and the card comes
   straight back. Tap, wait, card. Tap, wait, card. From the fridge that reads
   as "it keeps asking me to update", which is exactly the report that led here.

   So the build asking for the reload writes its own version down first, and
   the page that comes back compares. Same version means the update stalled and
   the ordinary path has already been tried once — offer the bigger hammer
   instead of the same button again.

   sessionStorage rather than localStorage on purpose: this is a fact about one
   reload of one tab, and it should not outlive the tab that recorded it.
   -------------------------------------------------------------------------- */

const ATTEMPT_KEY = 'mykitchenhub.updateAttempt';

/** Note that `version` is the build that asked for the reload. */
export const markUpdateAttempt = (version) => {
  try {
    sessionStorage.setItem(ATTEMPT_KEY, version);
  } catch {
    // Private mode, or storage full. The guard is a nicety; losing it costs
    // the old behaviour, not a broken update.
  }
};

/** Did the last attempt reload us straight back onto the build that started it? */
/** Did the last tap record this exact version as the one it was leaving? */
export const updateAttemptMatches = (version) => {
  try {
    return sessionStorage.getItem(ATTEMPT_KEY) === version;
  } catch {
    return false;
  }
};

/**
 * Did the last update fail to apply?
 *
 * Two conditions, and the second is the one that was missing. An unchanged
 * version label is *not* on its own evidence of a stall: the label is the
 * roadmap step, several builds can carry the same one, and updating between
 * two of those leaves it reading exactly as it did before. Deciding on the
 * label alone reported a perfectly good update as a failure and offered to
 * wipe the tablet to fix it — which is the worse of the two ways to be wrong,
 * because the remedy costs the user their session and does nothing.
 *
 * So the label only says "this might be the build we tried to leave". What
 * settles it is whether a worker is *still waiting*: if the update applied,
 * the waiting slot is empty, whatever the label says. That is plain browser
 * state, and it is the same thing that made the original fix work.
 */
export const didUpdateStall = async (version) => {
  if (!updateAttemptMatches(version)) return false;
  // Same label. Only a build still sitting unapplied makes it a stall.
  return Boolean(await getWaitingWorker());
};

/** Forget the last attempt, so a stall is reported once rather than forever. */
export const clearUpdateAttempt = () => {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* nothing to clear */
  }
};

/**
 * The last resort: throw the service worker away entirely and reload.
 *
 * Unregistering means the next load has no worker to serve a stale shell, so
 * index.html and the bundle come from the network — which is the one thing
 * that cannot be defeated by a worker that will not activate.
 *
 * Unlike `applyUpdate` this does delete the precache, because keeping it is
 * pointless once the worker that owns it is gone. The cost is that the app is
 * not available offline until a new worker installs, which on the next load it
 * does. IndexedDB is still left alone: Firebase Auth keeps the session there,
 * and a wall tablet signing itself out is a worse outcome than a slow reload.
 */
export const forceReinstall = async ({ reload = () => window.location.reload() } = {}) => {
  applying = true;

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister().catch(() => false)));
    } catch {
      // Nothing to unregister, or the browser refused. The reload below is
      // still worth doing.
    }
  }

  if (typeof caches !== 'undefined') {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name).catch(() => false)));
    } catch {
      /* same reasoning as above */
    }
  }

  clearUpdateAttempt();
  reload();
};

/**
 * Resolve when `worker` stops installing, whichever way it goes.
 *
 * 'installed' is the one we want; 'activated' covers a worker that raced
 * straight past it, and 'redundant' means a newer one superseded it while we
 * watched — all three end the wait, because in none of them is anything still
 * arriving.
 */
const waitForInstalled = (worker) =>
  new Promise((resolve) => {
    if (!worker || worker.state !== 'installing') {
      resolve();
      return;
    }
    const onChange = () => {
      if (worker.state === 'installing') return;
      worker.removeEventListener('statechange', onChange);
      resolve();
    };
    worker.addEventListener('statechange', onChange);
  });

/** Resolve `promise`, or resolve anyway once `ms` has passed. */
const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);

/**
 * Re-check the server for a newer build, and wait for it to finish installing.
 *
 * Without this, tapping "Update Now" activates whichever build was waiting as
 * of the last check — the hourly poll, or whenever the tablet last woke. Ship
 * twice between those and the tap applies the older of the two, the page
 * reloads, the poll immediately finds the newer one, and the card comes back.
 * From the fridge that reads as an update button that only half works.
 *
 * Never rejects. Offline, `update()` throws and the already-waiting build is
 * the right thing to apply — it is still newer than what is running.
 */
export const refreshRegistration = async (timeoutMs = REFRESH_TIMEOUT_MS) => {
  if (!('serviceWorker' in navigator)) return null;

  let registration = null;
  try {
    registration = await navigator.serviceWorker.getRegistration();
  } catch {
    return null;
  }
  if (!registration) return null;

  if (typeof registration.update === 'function') {
    try {
      await withTimeout(Promise.resolve(registration.update()), timeoutMs);
    } catch {
      // Offline, or the fetch failed. Fall through and use what is waiting.
    }
  }

  // `update()` may have started a newer worker installing, which takes the
  // waiting slot from the one that was there. Activating before it lands would
  // apply the build we just superseded.
  if (registration.installing) {
    await withTimeout(waitForInstalled(registration.installing), timeoutMs);
  }

  return registration;
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
  refreshMs = REFRESH_TIMEOUT_MS,
  reload = () => window.location.reload(),
  version = null,
} = {}) => {
  applying = true;
  onStage('checking');

  // Written before anything else can go wrong. If the reload below lands on
  // this same version, the page that comes back knows the update stalled.
  if (version) markUpdateAttempt(version);

  // Find the newest build *before* activating anything. `registration.waiting`
  // holds whichever build installed at the last check, which is not
  // necessarily the newest one deployed — and activating a superseded build
  // reloads the page straight into finding its successor, which is the
  // "I have to update twice" this fixes.
  const registration = await refreshRegistration(refreshMs);

  onStage('activating');
  const waiting = registration?.waiting ?? (await getWaitingWorker());
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
