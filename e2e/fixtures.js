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
 * The popup opens over every page for a browser that hasn't dismissed it and
 * swallows clicks. Specs that actually care about the popup opt out with
 * `test.use({ suppressWhatsNew: false })`.
 */
const suppressWhatsNewPopup = (page) =>
  page.addInitScript(
    ([key, version]) => window.localStorage.setItem(key, version),
    [WHATS_NEW_KEY, WHATS_NEW[0].version]
  );

/**
 * Hides the Firebase SDK's "Running in emulator mode" banner.
 *
 * The banner is fixed to the bottom of the viewport and is injected by the SDK,
 * not by the app — so it exists only under the emulators. On a phone viewport it
 * sits over the footer of any tall modal and swallows the submit click, which
 * Playwright reports as a mystery timeout on a visible, enabled button.
 */
const hideEmulatorBanner = (page) =>
  page.addInitScript(() => {
    const hide = () => {
      const style = document.createElement('style');
      style.textContent = '.firebase-emulator-warning { display: none !important; }';
      document.head.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener('DOMContentLoaded', hide);
  });

/**
 * Signs in through the real login form and waits for the dashboard.
 *
 * Only `e2e/auth.setup.js` and the auth spec call this — every other spec
 * starts from the shared signed-in storage state, because a login costs ~15s.
 *
 * Selectors target placeholders rather than labels: the login form's
 * Form.Label elements are not associated with their inputs via htmlFor.
 */
const login = async (page) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
  await page.getByPlaceholder('••••••••').first().fill(TEST_USER.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
};

const test = base.extend({
  // Opt out per-spec with test.use({ suppressWhatsNew: false }).
  suppressWhatsNew: [true, { option: true }],

  page: async ({ page, suppressWhatsNew }, use) => {
    if (suppressWhatsNew) await suppressWhatsNewPopup(page);
    await hideEmulatorBanner(page);
    await use(page);
  },

  /**
   * A signed-in page, already showing the app.
   *
   * The session itself comes from the shared storage state established by the
   * `setup` project. This still navigates to the dashboard so the fixture
   * hands back a *loaded* page: specs reasonably expect that, and a fixture
   * that silently yields about:blank fails in a very confusing way.
   *
   * Specs that want a different route just navigate again.
   */
  authedPage: async ({ page }, use) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await use(page);
  },
});

module.exports = {
  test,
  expect,
  login,
  suppressWhatsNewPopup,
  hideEmulatorBanner,
  WHATS_NEW_KEY,
  TEST_USER,
};
