// Firebase Analytics (GA4) against the real production bundle.
//
// Not to be confused with analytics.spec.js, which covers the *shopping*
// analytics page. This is the measurement wiring from src/services/analytics.js.
//
// The end-to-end build sets REACT_APP_USE_EMULATORS=true and carries no
// measurement id, so analytics must stay switched off. That is the condition
// worth proving against a real bundle rather than a mocked module: the unit
// tests assert the module declines to start, but only the real build proves
// nothing loads a measurement script, nothing reaches Google, and the app is
// exactly the app a cook with tracking blocked would get.

const { test, expect } = require('./fixtures');

/** Hosts the GA4 SDK talks to. Nothing should reach any of them. */
const MEASUREMENT_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'g.doubleclick.net',
];

const isMeasurementRequest = (url) => MEASUREMENT_HOSTS.some((host) => url.includes(host));

test.describe('firebase analytics', () => {
  test('sends nothing to Google, and loads no measurement script', async ({ authedPage: page }) => {
    const measurementRequests = [];
    page.on('request', (request) => {
      if (isMeasurementRequest(request.url())) measurementRequests.push(request.url());
    });

    // Three real screens, so this covers navigation as well as first paint —
    // GA4's enhanced measurement reports page views from history events, which
    // is exactly what a single-page app does on every navigation.
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    await page.goto('/recipes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    expect(measurementRequests).toEqual([]);

    // And nothing installed the global the GA4 script brings with it.
    const globals = await page.evaluate(() => ({
      gtag: typeof window.gtag,
      dataLayer: Array.isArray(window.dataLayer) ? window.dataLayer.length : null,
    }));
    expect(globals.gtag).toBe('undefined');
    expect(globals.dataLayer).toBeNull();
  });

  test('leaves the app fully usable with analytics off', async ({ authedPage: page }) => {
    // The point of the whole module: a cook with tracking blocked, an
    // unsupported browser, or no GA4 property at all gets the same app. If
    // analytics being off could break a page, it would break it here.
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/recipes', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Seeded Sheet Pan Salmon')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
