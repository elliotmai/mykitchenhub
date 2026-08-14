// e2e/fixtures.js
// Shared helpers for the end-to-end specs.

const { test: base, expect } = require('@playwright/test');
const { TEST_USER } = require('./global-setup');
const { WHATS_NEW } = require('../src/config/whatsNew');

// Must match STORAGE_KEY in src/components/Common/WhatsNew.jsx.
const WHATS_NEW_KEY = 'mykitchenhub.whatsNewSeen';

/**
 * Marks the current What's New entry as already seen.
 *
 * Every Playwright test gets a clean browser profile, so the popup would open
 * on top of every page and swallow clicks. Specs that actually care about the
 * popup opt out with `test.use({ suppressWhatsNew: false })`.
 */
const suppressWhatsNewPopup = (page) =>
  page.addInitScript(
    ([key, version]) => window.localStorage.setItem(key, version),
    [WHATS_NEW_KEY, WHATS_NEW[0].version]
  );

/**
 * Signs in through the real login form and waits for the dashboard.
 *
 * Selectors target placeholders rather than labels: the login form's
 * Form.Label elements are not associated with their inputs via htmlFor.
 */
const login = async (page) => {
  await page.goto('/login');

  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
  await page.getByPlaceholder('••••••••').first().fill(TEST_USER.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
};

const test = base.extend({
  // Opt out per-spec with test.use({ suppressWhatsNew: false }).
  suppressWhatsNew: [true, { option: true }],

  page: async ({ page, suppressWhatsNew }, use) => {
    if (suppressWhatsNew) await suppressWhatsNewPopup(page);
    await use(page);
  },

  /** An already-authenticated page, so specs start from a signed-in app. */
  authedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

module.exports = { test, expect, login, suppressWhatsNewPopup, WHATS_NEW_KEY, TEST_USER };
