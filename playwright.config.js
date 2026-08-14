// playwright.config.js
// End-to-end tests run a *production build* of the PWA against the Firebase
// emulators, so they exercise the real bundle, the real service worker, and
// the real Firestore security rules.
//
// Run with:  npm run test:e2e
// which wraps this in `firebase emulators:exec --only auth,firestore`.

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

  // Specs share one seeded account, so anything that writes must use a unique
  // item name. With that rule held, they can safely run in parallel.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A spec signs in through the real login form against the auth emulator,
  // which alone costs ~15s; with several workers sharing the emulator, 30s is
  // not enough headroom.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
    {
      // The app is mobile-first (roadmap 9.1), so the mobile viewport is a
      // first-class target rather than an afterthought.
      name: 'mobile-chromium',
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
