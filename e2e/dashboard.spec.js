// The dashboard against a real build, real emulators and real security rules.
//
// The seed (e2e/global-setup.js) gives the account three items — one expired,
// one due tomorrow, one that keeps for months. Specs share that one account,
// so any collection another phase writes to (recipes, meal plan entries,
// deliveries) may hold whatever ran first — assert against the database, or
// against a floor, never against an exact count you did not create.
//
// The important spec here is the last one. Every panel is fed by a collection
// somebody else writes, so a unit test can only prove the dashboard renders the
// shape it was told to expect. Scheduling a meal through the meal-plan UI and
// then reading it off the dashboard is what proves the two halves agree — a
// reader pointed at the wrong collection passes every mocked test and shows an
// empty week forever.

const { test, expect, addInventoryItem } = require('./fixtures');
const { mealPlanEntry, recipeCount, seedRecipe } = require('./firestore-admin');

const statValues = (page) => page.getByTestId('stat-card-value');

/** `YYYY-MM-DD` in local time — the format meal plan entries are keyed on. */
const toDayKey = (date) => {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const TODAY = toDayKey(new Date());

/**
 * Put a meal on today through the real meal-plan UI, the way a person would.
 *
 * Deliberately not a direct Firestore write: the point is to exercise the
 * writer the app actually ships, so the dashboard is reading whatever that
 * writer produces rather than whatever a fixture claims it produces.
 */
const scheduleMealToday = async (page, recipeName) => {
  await page.goto('/meal-plan', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Meal Plan' })).toBeVisible();

  const dayCard = page.getByTestId(`day-card-${TODAY}`);
  await dayCard.getByRole('button', { name: /Add a meal on/ }).click();

  const modal = page.locator('.modal.show');
  await expect(modal).toBeVisible();
  await modal.getByLabel('What are you cooking?').fill(recipeName);
  await modal.getByRole('button', { name: 'Add to plan' }).click();
  await expect(modal).not.toBeVisible();

  // On screen is not proof — confirm it reached Firestore through the rules.
  await expect
    .poll(async () => Boolean(await mealPlanEntry(recipeName)), {
      message: `waiting for "${recipeName}" to reach Firestore`,
      timeout: 10_000,
    })
    .toBe(true);
};

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

  test('counts the recipe library as the database actually has it', async ({
    authedPage: page,
  }) => {
    // This asserted a literal '0' when it was written, on the reasoning that
    // nothing in the suite wrote recipes. Phase 5's HelloFresh import now does,
    // and specs share one account — so the tile is checked against the real
    // count instead. That still catches the failure this guards against (a
    // blank, NaN or undefined tile), and no longer depends on which other
    // specs happened to run first.
    //
    // Polled rather than read once: the tile is counted at mount, so a recipe
    // written by another spec between the two reads leaves them one apart
    // until the next load. A real mismatch never settles.
    test.setTimeout(120_000);

    await expect
      .poll(
        async () => {
          await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
          await expect(statValues(page).nth(2)).toHaveText(/^\d+$/, { timeout: 15_000 });
          return (await statNumber(page, 2)) - (await recipeCount());
        },
        { message: 'waiting for the recipe tile to match the database', timeout: 60_000 }
      )
      .toBe(0);
  });

  test('shows a recipe added to the library', async ({ authedPage: page }) => {
    // The spec above proves the tile agrees with the database; this one proves
    // it is that database it is reading. An empty library makes "0 === 0" true
    // of any collection, so this writes one and waits for the number to move.
    //
    // Phase 4 has not shipped a recipe editor, so the owning UI cannot be
    // driven here — the write goes through the documented contract instead.
    // The read is still the real thing: the real bundle, through the real
    // rules, off the real collection. A dashboard counting some other
    // collection shows a number that never moves.
    test.setTimeout(120_000);

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    const tile = statValues(page).nth(2);
    await expect(tile).toHaveText(/^\d+$/, { timeout: 20_000 });
    const before = Number(await tile.innerText());

    await seedRecipe({ name: `E2E Dashboard Recipe ${Date.now()}` });

    // The count is read once per mount, so each attempt is a fresh load. Other
    // specs import recipes too, so this waits for the number to *rise* rather
    // than for one particular total.
    await expect
      .poll(
        async () => {
          await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
          await expect(tile).toHaveText(/^\d+$/, { timeout: 15_000 });
          return Number(await tile.innerText());
        },
        { message: 'waiting for the recipe tile to notice a new recipe', timeout: 60_000 }
      )
      .toBeGreaterThan(before);
  });

  test('counts an item added through the inventory page', async ({ authedPage: page }) => {
    // The other half of the seam the meal-plan spec covers: the tile is fed by
    // a collection the inventory page owns, so the inventory page is what
    // writes it here.
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    const tile = statValues(page).nth(0);
    await expect(tile).toHaveText(/^\d+$/, { timeout: 20_000 });
    const before = Number(await tile.innerText());

    await addInventoryItem(page, { name: `E2E Dashboard Item ${Date.now()}` });

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(tile).toHaveText(/^\d+$/, { timeout: 20_000 });
    expect(Number(await tile.innerText())).toBeGreaterThan(before);
  });

  test('agrees with the Waste Alerts page about what is expiring', async ({ authedPage: page }) => {
    // Two screens, one number. The dashboard counts by expiration *status*, the
    // waste-alerts page by a five-day window; they are meant to be the same set
    // and nothing but this checks it against real documents.
    test.setTimeout(120_000);

    await expect
      .poll(
        async () => {
          await page.goto('/waste-alerts', { waitUntil: 'domcontentloaded' });
          await expect(page.getByTestId('summary-expired')).toBeVisible({ timeout: 15_000 });

          const buckets = await Promise.all(
            ['expired', 'critical', 'warning'].map(async (key) =>
              Number((await page.getByTestId(`summary-${key}`).innerText()).match(/\d+/)[0])
            )
          );
          const wasteTotal = buckets.reduce((sum, n) => sum + n, 0);

          await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
          await expect(statValues(page).nth(1)).toHaveText(/^\d+$/, { timeout: 15_000 });
          const dashboardTotal = Number(await statValues(page).nth(1).innerText());

          return dashboardTotal - wasteTotal;
        },
        {
          // Specs run in parallel, so an item can be added between the two
          // reads. Polling lets that settle; a real disagreement never does.
          message: 'waiting for the two screens to report the same count',
          timeout: 60_000,
        }
      )
      .toBe(0);
  });

  test('lists the food that needs rescuing, worst first', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    const alerts = page.locator('.urgent-alert');
    // The seed guarantees two: Old Yogurt expired two days ago, Fresh Salmon is
    // due tomorrow. Other specs add their own items, so this is a floor.
    await expect(alerts.nth(1)).toBeVisible({ timeout: 20_000 });

    // Whatever else is on the list, already-expired sorts above due-today.
    // innerText is what the reader sees, and the badge is uppercased in CSS.
    const statuses = (await page.locator('.urgent-alert__status').allInnerTexts()).map((s) =>
      s.trim().toLowerCase()
    );

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses[0]).toBe('expired');
    expect(statuses).toEqual(
      [...statuses].sort((a, b) => (a === b ? 0 : a === 'expired' ? -1 : 1))
    );
  });

  test('names the week it is previewing', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Scoped to the preview card: the quick-action list also links to
    // /meal-plan, under the longer label "Plan this week's meals".
    const preview = page.locator('.meal-plan-preview');
    await expect(preview).toBeVisible({ timeout: 20_000 });

    // The card names the week it is describing, e.g. "Aug 10 – Aug 16".
    await expect(preview).toContainText(/[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}/);

    // Meal-plan specs schedule into the same account, so the week may be empty
    // or full by the time this runs. Both states offer a way through to the
    // plan; the empty state itself is covered by the component's unit tests.
    await expect(preview.getByRole('link', { name: /plan/i })).toBeVisible();
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

  test('shows a meal scheduled from the meal-plan page', async ({ authedPage: page }) => {
    // Unique per run: specs share one seeded account and run in parallel.
    const recipeName = `E2E Dashboard Dinner ${Date.now()}`;

    await scheduleMealToday(page, recipeName);

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // The preview reads the same collection the meal-plan page just wrote to.
    // If the two ever point at different collections, this is what fails.
    const preview = page.locator('.meal-plan-preview');
    await expect(preview).toContainText(recipeName, { timeout: 20_000 });

    // …and the meal is counted, not just listed.
    expect(await statNumber(page, 3)).toBeGreaterThanOrEqual(1);

    // It lands on today's row, not on some other day of the week.
    const todayRow = preview.locator('.meal-plan-day--today');
    await expect(todayRow).toHaveCount(1);
    await expect(todayRow).toContainText(recipeName);
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
