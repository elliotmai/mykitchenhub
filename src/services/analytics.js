// src/services/analytics.js
// Firebase Analytics (GA4) wiring — roadmap 10.2.
//
// Analytics is entirely optional. It switches itself on only when all four of
// these hold, and stays silently off otherwise:
//
//   1. REACT_APP_FIREBASE_MEASUREMENT_ID is set (a GA4 property exists)
//   2. the build is not pointed at the emulators
//   3. the browser supports it (isSupported() covers cookie-less contexts,
//      some in-app browsers, and anything without IndexedDB)
//   4. loading the measurement script actually succeeds — an ad blocker is a
//      normal outcome, not an error worth surfacing
//
// Nothing in the app reads a return value from this module, and every entry
// point swallows its own failures. Analytics must never be able to break a
// page, and a cook with tracking blocked must get exactly the same app as one
// without.
//
// PAGE VIEWS ARE NOT SENT FROM HERE. GA4's enhanced measurement already
// reports page views from browser history events, which is how a single-page
// app navigates. Sending them by hand as well would double-count every screen.
// See docs/DEPLOYMENT.md for the console toggle that turns that on.

import { getAnalytics, isSupported, logEvent, setUserProperties } from 'firebase/analytics';

import app from './firebase';
import { APP_VERSION } from '../config/version';

/** The live Analytics handle, or null while off. */
let analytics = null;

/** The in-flight (or settled) initialisation, so init runs at most once. */
let initPromise = null;

/** Reason analytics is off, for the dev-console log and for tests. */
let disabledReason = 'not-initialised';

/**
 * Why analytics would be off before we even ask the browser.
 *
 * @returns {string|null} the reason, or null if the config looks usable
 */
export const configProblem = (env = process.env) => {
  if (env.REACT_APP_USE_EMULATORS === 'true') return 'emulators';
  if (!env.REACT_APP_FIREBASE_MEASUREMENT_ID) return 'no-measurement-id';
  return null;
};

/**
 * Start Analytics, if this build and browser can have it.
 *
 * Safe to call more than once: later calls return the first call's promise
 * rather than creating a second measurement session.
 *
 * @returns {Promise<boolean>} whether analytics ended up switched on
 */
export const initAnalytics = () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const problem = configProblem();
    if (problem) {
      disabledReason = problem;
      return false;
    }

    try {
      if (!(await isSupported())) {
        disabledReason = 'unsupported-browser';
        return false;
      }

      analytics = getAnalytics(app);

      // Stamp the build onto the session. Without it a GA4 report cannot tell
      // "nobody hit the new page" from "nobody has the new build yet", which is
      // the first question worth asking after a release.
      setUserProperties(analytics, { app_version: APP_VERSION });

      disabledReason = null;
      return true;
    } catch (error) {
      // A blocked or failed measurement script lands here. It is not worth a
      // console.error — for most users this is an ad blocker doing its job.
      analytics = null;
      disabledReason = 'unavailable';
      console.info('Analytics is not available; continuing without it.');
      return false;
    }
  })();

  return initPromise;
};

/** Is analytics currently reporting? */
export const isAnalyticsEnabled = () => analytics !== null;

/** Why analytics is off, or null when it is on. */
export const analyticsDisabledReason = () => disabledReason;

/**
 * Record a custom event, if analytics is on.
 *
 * A no-op — never a throw — when it is off, so a caller never needs to guard.
 *
 * @param {string} name   - GA4 event name, snake_case
 * @param {object} params - event parameters; never put anything identifying here
 */
export const logAppEvent = (name, params = {}) => {
  if (!analytics || !name) return false;

  try {
    logEvent(analytics, name, params);
    return true;
  } catch (error) {
    console.info(`Analytics event "${name}" was not recorded.`);
    return false;
  }
};

/**
 * Forget everything this module remembers.
 *
 * Exported for tests: the module-level handle is a deliberate singleton, and
 * each test needs a clean one.
 */
export const __resetAnalytics = () => {
  analytics = null;
  initPromise = null;
  disabledReason = 'not-initialised';
};
