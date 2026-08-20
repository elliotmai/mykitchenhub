// src/config/version.js
// Single source of truth for the app version shown in the footer.
//
// The version tracks the development roadmap: `0.<phase>.<step>`.
// Completing roadmap step 4.3 (Manual Recipe Creation) means APP_VERSION '0.4.3'.
// The leading 0 stays until the roadmap is finished and the app ships 1.0.0.
//
// It is a roadmap coordinate, not a semantic version and not a date: 0.10.3 is
// *later* than 0.9.4, because phase 10 follows phase 9.
//
// WHEN YOU COMPLETE A ROADMAP STEP:
//   1. Bump APP_VERSION and ROADMAP_STEP here.
//   2. Bump "version" in package.json to the same value.
//   3. Add a What's New entry in src/config/whatsNew.js (or use the
//      [whats-new: none] commit tag if users truly won't notice).
//
// src/config/__tests__/version.test.js fails the build if these drift apart,
// so the footer can never silently lie about what's deployed.

/** Version string rendered in the footer, e.g. "0.8.2". */
export const APP_VERSION = '0.10.7';

/** The roadmap step this build completes, e.g. "8.2". */
export const ROADMAP_STEP = '10.7';

/** Human-readable name of that roadmap step — shown in the footer tooltip. */
export const ROADMAP_STEP_NAME = 'One-Tap Update';

export default APP_VERSION;

/**
 * Identifies the build, not the milestone.
 *
 * APP_VERSION is a roadmap coordinate and several builds share one — which is
 * why the footer alone could not confirm an update had landed. This is stamped
 * from the commit at build time and changes whenever the code does.
 *
 * Empty in development and in tests, where there is no build to identify; the
 * footer leaves it out rather than showing an empty pair of brackets.
 */
export const BUILD_ID = process.env.REACT_APP_BUILD_ID || '';
