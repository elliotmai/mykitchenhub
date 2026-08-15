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

  // -------------------------------------------------------------------------
  // What is actually in the precache
  //
  // The build job asserts build/service-worker.js exists, and the test below
  // asserts the app registers it. Neither looks at what it precaches, and
  // `self.__WB_MANIFEST` resolving to an empty array is a silent way to ship a
  // worker that installs, activates, controls the page — and caches nothing.
  // Every check we have would still be green and offline would be broken.
  // -------------------------------------------------------------------------

  /** The precache manifest, read out of the built worker. */
  const precacheEntries = async (page) => {
    const source = await (await page.request.get('/service-worker.js')).text();

    // The manifest survives minification as object literals. Which quote
    // character it ends up in is the minifier's business, so accept either.
    return [
      ...source.matchAll(
        /\{['"]revision['"]:(null|['"][^'"]*['"]),['"]url['"]:['"]([^'"]+)['"]\}/g
      ),
    ].map((m) => ({ revision: m[1], url: m[2] }));
  };

  test('precaches the app shell, with a revision on the one unhashed file', async ({ page }) => {
    const entries = await precacheEntries(page);
    const urls = entries.map((e) => e.url);

    expect(entries.length).toBeGreaterThan(5);
    expect(urls).toContain('/index.html');
    expect(urls.some((u) => /\/static\/js\/main\.[^/]+\.js$/.test(u))).toBe(true);
    expect(urls.some((u) => u.endsWith('.css'))).toBe(true);

    // Everything webpack emits carries its hash in the filename, so workbox
    // stores it with `revision: null` and the URL itself is the cache key.
    // index.html does not — its name never changes — so it is the one entry
    // that needs a content revision. Without it the shell is cached under a key
    // that never moves: no update is ever detected, and every browser that has
    // visited once keeps the old app forever, which is the failure mode a
    // service worker that caches too well produces.
    const index = entries.find((e) => e.url === '/index.html');
    expect(index.revision).not.toBe('null');
    expect(index.revision).toMatch(/^['"][a-f0-9]{8,}['"]$/);
  });

  test('precaches nothing it does not actually serve', async ({ page }) => {
    // A manifest entry that 404s rejects the install, and a worker that never
    // installs is a PWA with no offline at all — the exact thing this phase
    // set out to fix.
    const entries = await precacheEntries(page);
    expect(entries.length).toBeGreaterThan(5);

    const statuses = await Promise.all(
      entries.map(async ({ url }) => ({ url, status: (await page.request.get(url)).status() }))
    );

    expect(statuses.filter((s) => s.status !== 200)).toEqual([]);
  });

  test('caches the offline page its catch handler falls back to', async ({ page }) => {
    // Not part of the precache manifest — the worker's own install handler does
    // `cache.add('/offline.html')`, and a rejected add fails the whole install.
    const response = await page.request.get('/offline.html');
    expect(response.status()).toBe(200);
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
