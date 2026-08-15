// e2e/fixtures.js
// Shared helpers for the end-to-end specs.

const fs = require('fs');
const path = require('path');
const { test: base, expect } = require('@playwright/test');
const { TEST_USER, EMPTY_USER, accountForWorker } = require('./accounts');
const { WHATS_NEW } = require('../src/config/whatsNew');

// Must match STORAGE_KEY in src/components/Common/WhatsNew.jsx.
const WHATS_NEW_KEY = 'mykitchenhub.whatsNewSeen';

/** Where a worker parks the signed-in state it captured for itself. */
const workerStatePath = (index) => path.join(__dirname, '.auth', `worker-${index}.json`);

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
 * Called by e2e/auth.spec.js, which is about signing in, and once per worker by
 * the storageState fixture below. Every other spec starts from the captured
 * state, because a login costs ~15s.
 *
 * Selectors target placeholders rather than labels: the login form's
 * Form.Label elements are not associated with their inputs via htmlFor.
 */
const login = async (page, account = TEST_USER) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  await page.getByPlaceholder('you@example.com').fill(account.email);
  await page.getByPlaceholder('••••••••').first().fill(account.password);
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

/** The What's New suppression and nothing else — shared by both test objects. */
const withWhatsNewOption = (testObject) =>
  testObject.extend({
    // Opt out per-spec with test.use({ suppressWhatsNew: false }).
    suppressWhatsNew: [true, { option: true }],

    page: async ({ page, suppressWhatsNew }, use) => {
      if (suppressWhatsNew) await suppressWhatsNewPopup(page);
      await use(page);
    },
  });

/**
 * The signed-in test object every spec but the auth one uses.
 *
 * Each worker signs in once as its own account (e2e/accounts.js) and every test
 * in that worker starts from it. That replaces the old `setup` project, which
 * produced one shared state file — and with it, one shared kitchen that every
 * spec wrote into and none cleaned up.
 *
 * The logins happen concurrently, one per worker, so the wall-clock cost is
 * the same single ~15s login it always was.
 *
 * The two-fixture shape is required, not stylistic: `storageState` is a
 * built-in *test-scoped* option, and redefining it with `{ scope: 'worker' }`
 * is rejected outright ("has already been registered as a { scope: 'test' }
 * fixture"). So the expensive part lives in a worker fixture, and the built-in
 * option is overridden with a one-line test-scoped fixture that reads it.
 */
const test = withWhatsNewOption(base).extend({
  /**
   * The account this worker owns.
   *
   * The unused first parameter is Playwright's fixture-dependencies object;
   * this fixture needs none of them, only the workerInfo that follows it.
   */
  workerAccount: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      await use(accountForWorker(workerInfo.parallelIndex));
    },
    { scope: 'worker' },
  ],

  /** Signed-in state for this worker's account, captured once per run. */
  workerStorageState: [
    async ({ browser, workerAccount }, use, workerInfo) => {
      const file = workerStatePath(workerInfo.parallelIndex);
      fs.mkdirSync(path.dirname(file), { recursive: true });

      // Captured fresh every run rather than reused from disk: the emulator's
      // ID tokens expire after an hour, and a stale file restores a browser
      // that looks signed in until the first Firestore read is refused.
      //
      // baseURL has to be passed in by hand. `use.baseURL` is applied by the
      // `context` fixture, and this page comes straight off `browser`, so
      // without it `page.goto('/login')` is a relative path with nothing to be
      // relative to — "Cannot navigate to invalid URL".
      const page = await browser.newPage({
        storageState: undefined,
        baseURL: workerInfo.project.use.baseURL,
      });
      try {
        await login(page, workerAccount);
        // Confirm the app really considers us signed in before capturing.
        await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible();

        // indexedDB: true is essential — the Firebase JS SDK persists its
        // session there, not in localStorage, so state saved without it
        // restores a signed-out browser.
        await page.context().storageState({ path: file, indexedDB: true });
      } finally {
        await page.context().close();
      }

      await use(file);
    },
    { scope: 'worker' },
  ],

  storageState: async ({ workerStorageState }, use) => {
    await use(workerStorageState);
  },

  /**
   * Signed-in state for the account with nothing in it, captured once per
   * worker. Kept apart from the worker account because the point of it is that
   * nothing ever writes to it.
   */
  emptyStorageState: [
    async ({ browser }, use, workerInfo) => {
      const file = path.join(__dirname, '.auth', `empty-${workerInfo.parallelIndex}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });

      const page = await browser.newPage({
        storageState: undefined,
        baseURL: workerInfo.project.use.baseURL,
      });
      try {
        await login(page, EMPTY_USER);
        await page.context().storageState({ path: file, indexedDB: true });
      } finally {
        await page.context().close();
      }

      await use(file);
    },
    { scope: 'worker' },
  ],

  /**
   * A page signed in as a cook who has added nothing yet.
   *
   * Its own context rather than the shared `page`, because storageState is
   * fixed when a context is created and this one needs a different account.
   */
  emptyPage: async ({ browser, baseURL, emptyStorageState, suppressWhatsNew }, use) => {
    const context = await browser.newContext({ storageState: emptyStorageState, baseURL });
    const page = await context.newPage();
    if (suppressWhatsNew) await suppressWhatsNewPopup(page);

    try {
      await use(page);
    } finally {
      await context.close();
    }
  },

  /**
   * A signed-in page, already showing the app.
   *
   * This still navigates to the dashboard so the fixture hands back a *loaded*
   * page: specs reasonably expect that, and a fixture that silently yields
   * about:blank fails in a very confusing way.
   *
   * Specs that want a different route just navigate again.
   */
  authedPage: async ({ page }, use) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Wait for the app to finish deciding whether it is signed in. Until then
    // ProtectedRoute is showing its loader, so returning here would hand the
    // spec a page that is about to navigate underneath it.
    await page.waitForFunction(
      () =>
        document.querySelector('.app-footer__version') !== null ||
        window.location.pathname.startsWith('/login'),
      null,
      { timeout: 30_000 }
    );

    // The shared storage state almost always restores the session. Under
    // parallel load the Auth emulator occasionally fails a token refresh, the
    // SDK resolves to signed-out, and ProtectedRoute sends the page to /login
    // — which then fails whatever the spec asserted first, for a reason that
    // has nothing to do with the spec. Signing in costs ~15s and only happens
    // on the rare run that needs it; the alternative is a suite that fails at
    // random on a different test each time.
    if (new URL(page.url()).pathname.startsWith('/login')) {
      await login(page);
    }

    await use(page);
  },
});

/**
 * The test object for specs that drive signing in themselves.
 *
 * Deliberately without the worker storageState above: a spec cannot override a
 * worker-scoped fixture from inside the file, and a spec about the login form
 * must not arrive already logged in. It gets the What's New suppression, since
 * the popup is in the way there too.
 */
const signedOutTest = withWhatsNewOption(base);

/** The header row every CSV fixture starts with. */
const CSV_HEADER = 'name,quantity,unit,location';

/** Attaches a CSV to the importer's file input, without touching the disk. */
const chooseCSV = async (page, text, name = 'kitchen.csv') => {
  const modal = page.locator('.modal.show');

  // Under a loaded machine this click occasionally lands on the button before
  // React has wired it up: nothing opens, and the spec fails somewhere far
  // from the cause. Retry the click itself rather than the whole test — the
  // modal still has to open, this only stops a dropped click reading as a bug.
  await expect(async () => {
    if (!(await modal.isVisible())) {
      await page.getByRole('button', { name: /import csv/i }).click();
    }
    await expect(modal).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  await modal.getByLabel('Choose a CSV file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text, 'utf8'),
  });

  return modal;
};

module.exports = {
  test,
  signedOutTest,
  expect,
  login,
  addInventoryItem,
  chooseCSV,
  CSV_HEADER,
  suppressWhatsNewPopup,
  workerStatePath,
  WHATS_NEW_KEY,
  TEST_USER,
};
