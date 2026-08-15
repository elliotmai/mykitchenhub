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

/**
 * Adds an item through the real add-item modal, the way a person would.
 *
 * Shared because three specs need it and every one of them needs it to be the
 * *shipped* writer: the dashboard, the analytics page and the waste alerts all
 * read a collection the inventory page owns, and a fixture written straight to
 * Firestore proves nothing about whether those two halves agree.
 *
 * Fields are addressed by placeholder. The modal has two <select> elements
 * (unit, then storage location) and its Form.Label elements are not associated
 * with their inputs via htmlFor, so getByLabel finds nothing.
 *
 * @param {import('@playwright/test').Page} page - already on a page with the
 *   "Add Item" button, or anywhere if `navigate` is left true
 * @param {object} item - name (required), quantity, price, store
 */
const addInventoryItem = async (page, { name, quantity = '1', price, store, navigate = true }) => {
  if (navigate) {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  }

  await page
    .getByRole('button', { name: /add item/i })
    .first()
    .click();

  const modal = page.locator('.modal.show');
  await expect(modal).toBeVisible();

  await modal.getByPlaceholder(/Chicken Breast/).fill(name);
  await modal.getByPlaceholder('e.g. 2').fill(String(quantity));
  if (price !== undefined) await modal.getByPlaceholder('e.g. 8.99').fill(String(price));
  if (store !== undefined)
    await modal
      .getByPlaceholder(/Costco/)
      .last()
      .fill(store);

  // Storage location is required; its <select> is the one containing the
  // "Select a location…" prompt.
  const locationSelect = modal.locator('select').filter({ hasText: 'Select a location' });
  const firstLocation = await locationSelect.locator('option').nth(1).getAttribute('value');
  await locationSelect.selectOption(firstLocation);

  await modal.getByRole('button', { name: 'Add Item' }).click();
  await expect(modal).not.toBeVisible();
};

const test = base.extend({
  // Opt out per-spec with test.use({ suppressWhatsNew: false }).
  suppressWhatsNew: [true, { option: true }],

  page: async ({ page, suppressWhatsNew }, use) => {
    if (suppressWhatsNew) await suppressWhatsNewPopup(page);
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
  addInventoryItem,
  suppressWhatsNewPopup,
  WHATS_NEW_KEY,
  TEST_USER,
};
