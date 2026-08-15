// playwright.config.js
// End-to-end tests run a *production build* of the PWA against the Firebase
// emulators, so they exercise the real bundle, the real service worker, and
// the real Firestore security rules.
//
// Run with:  npm run test:e2e
// which builds first, then wraps this in
// `firebase emulators:exec --only auth,firestore`.

const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.E2E_PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Some sandboxes ship a Chromium build that predates the pinned Playwright
// version, so the default download path is empty. Use the preinstalled binary
// when it's there; on CI, `playwright install chromium` provides the matching
// build at the default location and this stays unset.
const PREINSTALLED_CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOptions = fs.existsSync(PREINSTALLED_CHROMIUM)
  ? { executablePath: PREINSTALLED_CHROMIUM }
  : {};

module.exports = defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/global-setup'),

  // Each worker signs in as its own seeded account (e2e/accounts.js), so specs
  // no longer write into a kitchen the others are reading. The one exception is
  // the `recipes` collection, which the schema makes global — a spec that
  // creates a recipe must still use a unique name.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  // Signing in is done once per worker by the storageState fixture, so a spec's
  // own budget only has to cover navigation and interaction.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Video is off: traces already carry a DOM-accurate replay, and videos made
    // the failure artifact ~160 MB.
    video: 'off',
    launchOptions,
  },

  projects: [
    {
      name: 'desktop-chromium',
      // mobile.spec.js is the one spec that only means anything on a phone —
      // its whole subject is the layout, tap sizes and bottom bar that exist
      // below the breakpoint. Running it at 1280px asserts nothing and fails
      // on the nav bar it cannot find.
      testIgnore: /mobile\.spec\.js/,
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
    {
      // The app is mobile-first (roadmap 9.1), so the mobile viewport is a
      // first-class target — but only for the specs where being on a phone
      // changes the answer.
      //
      // Both projects used to run all 71 specs, which doubled the suite to pay
      // for re-asserting, at 412px, business logic that has nothing to do with
      // width: that a CSV row validates, that a shelf life is computed, that a
      // meal lands in Firestore. Those are already covered by the desktop run
      // and by 1500 unit tests.
      //
      // What genuinely differs on a phone is layout, tap size and navigation —
      // and mobile.spec.js checks those across every page. Alongside it:
      // navigation.spec.js (the routes render inside the mobile shell),
      // auth.spec.js (the login form is the first thing a phone sees), and
      // whats-new.spec.js (a modal whose footer is what the emulator banner
      // used to sit on top of).
      name: 'mobile-chromium',
      testMatch: /(mobile|navigation|auth|whats-new)\.spec\.js/,
      use: { ...devices['Pixel 7'], launchOptions },
    },
  ],

  webServer: {
    // Serves the build produced by `npm run build:e2e`.
    command: `npx serve -s build -l ${PORT} --no-clipboard`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
