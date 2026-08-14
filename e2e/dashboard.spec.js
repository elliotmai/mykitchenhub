// The dashboard against a real build, real emulators and real security rules.
//
// The seed (e2e/global-setup.js) gives the account three items — one expired,
// one due tomorrow, one that keeps for months — and no recipes and no meal
// plans. That is deliberately the state the dashboard has to survive: half its
// collections do not exist yet.

const { test, expect } = require('./fixtures');

const statValues = (page) => page.getByTestId('stat-card-value');

/**
 * Read a tile's number.
 *
 * Specs share one seeded account and run in parallel, so other specs may have
 * added items by the time this runs. Item counts are therefore asserted as
 * "at least the seeded set", never as an exact total.
 */
const statNumber = async (page, index) => Number(await statValues(page).nth(index).innerText());

test.describe('dashboard', () => {
  test('greets the signed-in cook', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/E2E Cook/);
  });

  test('counts the seeded kitchen instead of showing placeholders', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Every tile must resolve to a number — the page shipped with "--" in all four.
    await expect(statValues(page)).toHaveCount(4);
    await expect(statValues(page).nth(0)).toHaveText(/^\d+$/, { timeout: 20_000 });
    for (const index of [1, 2, 3]) {
      await expect(statValues(page).nth(index)).toHaveText(/^\d+$/);
    }

    // Three seeded items, two of them inside the five-day window.
    expect(await statNumber(page, 0)).toBeGreaterThanOrEqual(3);
    expect(await statNumber(page, 1)).toBeGreaterThanOrEqual(2);
  });

  test('reports zero for collections that do not exist yet', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Recipes and meal plans are owned by other roadmap phases and are unseeded.
    // Neither read may fail: a missing collection must count as zero.
    await expect(statValues(page).nth(3)).toHaveText('0', { timeout: 20_000 });
    await expect(page.getByText('No meals planned for this week yet.')).toBeVisible();
  });

  test('lists the food that needs rescuing, worst first', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    const alerts = page.locator('.urgent-alert');
    await expect(alerts).toHaveCount(2, { timeout: 20_000 });

    // Old Yogurt expired two days ago; Fresh Salmon is due tomorrow.
    await expect(alerts.nth(0)).toContainText('Old Yogurt');
    await expect(alerts.nth(0)).toContainText('Expired');
    await expect(alerts.nth(1)).toContainText('Fresh Salmon');
    await expect(alerts.nth(1)).toContainText('Use today');
  });

  test('offers to plan the week when nothing is scheduled', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Scoped to the preview card: the quick-action list also links to
    // /meal-plan, under the longer label "Plan this week's meals".
    const preview = page.locator('.meal-plan-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview).toContainText('No meals planned for this week yet.');
    await expect(preview.getByRole('link', { name: 'Plan this week', exact: true })).toBeVisible();

    // The card names the week it is describing, e.g. "Aug 10 – Aug 16".
    await expect(preview).toContainText(/[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}/);
  });

  test('quick actions reach the pages they promise', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    await page.getByRole('link', { name: 'See shopping insights' }).click();

    await expect(page).toHaveURL(/\/analytics/);
  });

  test('stat tiles link through to the page behind the number', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    await page.locator('a.stat-card').first().click();

    await expect(page).toHaveURL(/\/inventory/);
  });

  test('fits a phone screen without sideways scrolling', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(statValues(page).first()).toHaveText(/^\d+$/, { timeout: 20_000 });

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );

    expect(overflows).toBe(false);
  });
});
