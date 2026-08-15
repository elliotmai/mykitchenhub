// Roadmap 9.3 — what the app says when there is nothing to show, and what it
// does when there is no connection.
//
// These are the two states nobody builds a fixture for and everybody hits: the
// first five minutes after signing up, and a phone in a kitchen with thick
// walls. Both used to be a spinner or a blank panel, which reads as broken.
//
// `emptyPage` signs in as a cook who has a profile and the default shelves and
// nothing on them — see e2e/accounts.js.

const { test, expect } = require('./fixtures');

/**
 * Waits until the service worker is not just registered but *controlling* this
 * page.
 *
 * This matters more since the routes were split into chunks (roadmap 9.2):
 * offline, a page the cook has not visited yet is a chunk that has to come from
 * the precache, and only a controlling worker serves it. Without this wait the
 * test goes offline in the gap before the worker takes over, the chunk request
 * hits the network, and the failure looks like a bug in the app rather than a
 * race in the test.
 */
const waitForServiceWorker = async (page) => {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
    timeout: 30_000,
  });
};

/** Pages that render user-scoped data, and what each should say when it has none. */
const EMPTY_STATES = [
  ['/inventory', /your inventory is empty/i],
  ['/meal-plan', /no meals|nothing planned|plan your week|add a meal/i],
  ['/waste-alerts', /nothing to keep an eye on yet|nothing is going to waste/i],
  ['/analytics', /no shopping history yet/i],
  ['/hellofresh', /no deliveries|nothing logged|add.*delivery/i],
];

test.describe('a kitchen with nothing in it', () => {
  for (const [path, expected] of EMPTY_STATES) {
    test(`${path} explains itself rather than showing a blank panel`, async ({ emptyPage }) => {
      await emptyPage.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(emptyPage.locator('.app-footer__version')).toBeVisible();

      await expect(emptyPage.getByText(expected).first()).toBeVisible();
    });
  }

  test('the dashboard shows real zeroes, not placeholder dashes', async ({ emptyPage }) => {
    await emptyPage.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // "--" was what the tiles shipped with. A zero is a fact; a dash is the app
    // admitting it does not know, which for an empty kitchen is not true.
    const values = emptyPage.locator('[data-testid="stat-card-value"]');
    await expect(values.first()).toHaveText(/^\d+$/, { timeout: 20_000 });

    const count = await values.count();
    for (let i = 0; i < count; i += 1) {
      await expect(values.nth(i)).not.toHaveText('--');
    }
  });

  test('never leaves a spinner running with nothing behind it', async ({ emptyPage }) => {
    await emptyPage.goto('/inventory', { waitUntil: 'domcontentloaded' });

    // The empty state and a permanent spinner look the same for the first
    // second. Only one of them ends.
    await expect(emptyPage.getByText(/your inventory is empty/i)).toBeVisible();
    await expect(emptyPage.locator('[role="status"]')).toHaveCount(0);
  });
});

test.describe('with no connection', () => {
  test('still shows the kitchen it was showing a moment ago', async ({ authedPage: page }) => {
    // Load it once online so the on-disk Firestore cache has something in it,
    // and so the service worker has precached the route chunks.
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Basmati Rice')).toBeVisible();
    await waitForServiceWorker(page);

    await page.context().setOffline(true);

    // Navigated by clicking, not by page.goto. A goto is a full document
    // request, which offline depends on the service worker having activated —
    // a different thing to test, and a flaky one. Clicking is what a cook does
    // and what a single-page app is for: a route change with no network at all.
    //
    // The real question is whether the *data* survives. Before the persistent
    // cache went in (src/services/firebase.js) it did not — Firestore's
    // memory-only cache died with the page's connection and the list emptied,
    // showing "your inventory is empty" about a fridge with food in it.
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Dashboard' })
      .click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Inventory' })
      .click();
    await expect(page).toHaveURL(/\/inventory/);

    await expect(page.getByText('Basmati Rice')).toBeVisible();

    await page.context().setOffline(false);
  });

  test('says so, rather than leaving the cook guessing', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-footer__version')).toBeVisible();

    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await expect(page.getByText(/you.re offline/i)).toBeVisible();

    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.getByText(/back online/i)).toBeVisible();
  });
});
