// src/config/version.js
// Single source of truth for the app version shown in the footer.
//
// The version tracks the development roadmap: `0.<phase>.<step>`.
// Completing roadmap step 3.2 (Core Inventory CRUD) means APP_VERSION '0.3.2'.
// The leading 0 stays until the roadmap is finished and the app ships 1.0.0.
//
// WHEN YOU COMPLETE A ROADMAP STEP:
//   1. Bump APP_VERSION and ROADMAP_STEP here.
//   2. Bump "version" in package.json to the same value.
//   3. Add a What's New entry in src/config/whatsNew.js (or use the
//      [whats-new: none] commit tag if users truly won't notice).
//
// src/config/__tests__/version.test.js fails the build if these drift apart,
// so the footer can never silently lie about what's deployed.

/** Version string rendered in the footer, e.g. "0.3.3". */
export const APP_VERSION = '0.3.3';

/** The roadmap step this build completes, e.g. "3.3". */
export const ROADMAP_STEP = '3.3';

/** Human-readable name of that roadmap step — shown in the footer tooltip. */
export const ROADMAP_STEP_NAME = 'CSV Bulk Import';

export default APP_VERSION;
