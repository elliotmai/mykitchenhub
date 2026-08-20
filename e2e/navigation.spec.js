// Every route in the roadmap must be reachable, render inside the app shell,
// and work on a phone-sized viewport (roadmap 9.1 is mobile-first).

const { test, expect } = require('./fixtures');

const ROUTES = [
  ['/dashboard', /good (morning|afternoon|evening)/i],
  ['/inventory', /inventory/i],
  ['/recipes', /recipes/i],
  ['/meal-plan', /meal plan/i],
  ['/shopping-list', /shopping list/i],
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

  // Splitting the routes into chunks (roadmap 9.2) makes each page a separate
  // network request that can fail after the app is already running. When one
  // does, and retrying it does not help, the cook must be told — a page that
  // renders the chrome and then nothing at all inside it is the worst outcome,
  // because it looks like the app working and having no content.
  test('says so when a page chunk cannot be downloaded, instead of showing an empty panel', async ({
    authedPage: page,
  }) => {
    // Every lazily-loaded route is a `<id>.<hash>.chunk.js`; the initial bundle
    // is `main.<hash>.js` and is deliberately left alone, so the app still
    // boots and it is only the page inside the shell that cannot arrive.
    await page.route(/\/static\/js\/.*\.chunk\.js/, (route) =>
      route.fulfill({ status: 503, body: '' })
    );

    // Navigated rather than clicked, because this spec runs on both the desktop
    // and the phone project and the sidebar is a permanent rail on one and a
    // drawer on the other. Either way it is the dynamic import that has to
    // resolve before anything renders.
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });

    // Whichever way it settles, it must not be a shell with an empty content
    // area. Both endings are correct: the service worker may satisfy the chunk
    // from precache, in which case the page simply renders, and if it does not,
    // the error screen has to appear. The one unacceptable outcome — the app
    // looking like it worked, with nothing in it — is what this rules out.
    await expect
      .poll(
        async () => {
          const crashed = await page.getByText('Something went wrong').isVisible();
          if (crashed) return 'told the cook';

          const heading = await page
            .getByRole('heading', { name: /analytics/i })
            .first()
            .isVisible()
            .catch(() => false);
          return heading ? 'rendered the page' : 'blank';
        },
        { timeout: 20_000 }
      )
      .not.toBe('blank');
  });

  test('sends an unknown URL back to the dashboard', async ({ authedPage: page }) => {
    await page.goto('/no-such-page', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows a version that matches the deployed build', async ({ authedPage: page }) => {
    const { APP_VERSION } = require('../src/config/version');

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    const footer = page.locator('.app-footer__version');
    await expect(footer).toContainText(`v${APP_VERSION}`);

    // And the build code beside it. This is the half that answers "did the
    // update land" — the version alone cannot, because it is a roadmap
    // coordinate and consecutive builds share one. Asserted as a shape rather
    // than a value: it is stamped from the commit at build time, so the test
    // cannot know it, but it can insist it is there and is not empty.
    await expect(page.locator('.app-footer__build')).toHaveText(/^ \([0-9a-z]{4,}\)$/);
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

/** Does `name` match any of the prefixes the update clear-out preserves? */
const keep = (name, prefixes) => prefixes.some((prefix) => name.startsWith(prefix));

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

  // -------------------------------------------------------------------------
  // What the update clear-out is allowed to delete
  //
  // Applying an update empties the runtime caches and keeps two of them, on
  // the grounds that the incoming worker built those two during its install
  // and they hold the *new* content. That reasoning is only sound if the
  // prefixes it keeps actually match what a real browser ends up naming those
  // caches — `workbox-precache-v2-<origin>/` is workbox's business, not ours,
  // and a rename would turn "keep the app shell" into "delete the app shell
  // and take the fridge tablet offline until the next release".
  //
  // So the list is read out of the module rather than restated here: this
  // fails if the names drift apart, which is the only way it can go wrong.
  // -------------------------------------------------------------------------
  test('keeps exactly the caches the incoming worker built', async ({ authedPage: page }) => {
    const source = require('fs').readFileSync('src/utils/appUpdate.js', 'utf8');
    const declaration = source.match(/KEEP_CACHE_PREFIXES = \[([^\]]*)\]/);
    expect(declaration, 'KEEP_CACHE_PREFIXES not found in src/utils/appUpdate.js').toBeTruthy();
    const keepPrefixes = [...declaration[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(keepPrefixes.length).toBeGreaterThan(0);

    await expect(page.locator('.app-footer__version')).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
      timeout: 30_000,
    });

    // Both are written during install, so they exist by the time the worker
    // controls the page.
    const names = await page.evaluate(() => caches.keys());
    const kept = names.filter((name) => keep(name, keepPrefixes));

    expect(
      names.some((name) => name.startsWith('workbox-precache')),
      `no workbox precache among ${JSON.stringify(names)}`
    ).toBe(true);
    expect(
      names.some((name) => name.startsWith('offline-fallback')),
      `no offline fallback cache among ${JSON.stringify(names)}`
    ).toBe(true);

    // Every cache the worker built during install survives the clear-out...
    expect(kept).toEqual(
      expect.arrayContaining(names.filter((n) => /^(workbox-precache|offline-fallback)/.test(n)))
    );

    // ...and the app shell is genuinely in the one being kept, rather than the
    // prefix matching an empty cache that happens to be named right.
    const precacheName = names.find((name) => name.startsWith('workbox-precache'));
    const precached = await page.evaluate(
      async (name) => (await (await caches.open(name)).keys()).map((r) => r.url),
      precacheName
    );
    // Workbox stores a revisioned entry under a cache-busted key
    // (`/index.html?__WB_REVISION__=…`), so this cannot be an endsWith.
    expect(
      precached.some((url) => url.includes('/index.html')),
      `no index.html among ${JSON.stringify(precached)}`
    ).toBe(true);
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
