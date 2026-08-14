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
const { STORAGE_STATE } = require('./e2e/storage-state');

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

  // Signing in is done once by the `setup` project, so a spec's own budget only
  // has to cover navigation and interaction.
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
      // Signs in once and writes e2e/.auth/user.json.
      name: 'setup',
      testMatch: /auth\.setup\.js/,
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], launchOptions, storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      // The app is mobile-first (roadmap 9.1), so the mobile viewport is a
      // first-class target rather than an afterthought.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], launchOptions, storageState: STORAGE_STATE },
      dependencies: ['setup'],
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
