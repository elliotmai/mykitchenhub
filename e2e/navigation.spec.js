// Every route in the roadmap must be reachable, render inside the app shell,
// and work on a phone-sized viewport (roadmap 9.1 is mobile-first).

const { test, expect } = require('./fixtures');

const ROUTES = [
  ['/dashboard', /good (morning|afternoon|evening)/i],
  ['/inventory', /inventory/i],
  ['/recipes', /recipes/i],
  ['/meal-plan', /meal plan/i],
  ['/hellofresh', /hellofresh/i],
  ['/analytics', /analytics/i],
  ['/settings', /settings/i],
];

test.describe('navigation', () => {
  for (const [path, heading] of ROUTES) {
    test(`renders ${path}`, async ({ authedPage: page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      await expect(page.getByText(heading).first()).toBeVisible();
      // The shared layout — and therefore the version label — is always present.
      await expect(page.locator('.app-footer__version')).toBeVisible();
    });
  }

  test('sends an unknown URL back to the dashboard', async ({ authedPage: page }) => {
    await page.goto('/no-such-page', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows a version that matches the deployed build', async ({ authedPage: page }) => {
    const { APP_VERSION } = require('../src/config/version');

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.app-footer__version')).toHaveText(`v${APP_VERSION}`);
  });

  test('has no horizontal overflow on a phone viewport', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );

    expect(overflows).toBe(false);
  });
});

test.describe('progressive web app', () => {
  test('serves a manifest with the metadata needed to install', async ({ page }) => {
    const response = await page.request.get('/manifest.json');
    expect(response.ok()).toBe(true);

    const manifest = await response.json();
    expect(manifest.name || manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBeTruthy();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('ships the service worker the app registers', async ({ page }) => {
    const response = await page.request.get('/service-worker.js');

    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('javascript');
  });

  test('and the app actually registers it, so the precache exists', async ({
    authedPage: page,
  }) => {
    // Shipping the file is not the same as using it. register() attached its
    // listener to a `load` event that had already fired, so the worker was
    // never registered — the file was served, the build job's check passed, and
    // the app had no precache and no offline at all (roadmap 9.1).
    await expect(page.locator('.app-footer__version')).toBeVisible();

    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
      timeout: 30_000,
    });

    const scope = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
    expect(scope).toContain('/service-worker.js');
  });
});
