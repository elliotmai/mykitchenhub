// Shopping analytics against a real build and real emulators.
//
// The seeded items carry an empty purchaseHistory, so the page starts on its
// empty state. The first spec then adds a priced item through the real UI and
// checks the insights appear — which also proves the write survives the
// security rules, since a rejected write would never come back on the listener.

const { test, expect, addInventoryItem } = require('./fixtures');

/** Adds an item through the real inventory UI, with a price and a store. */
const addPricedItem = async (page, { name, price, store }) => {
  await addInventoryItem(page, { name, quantity: 2, price, store });
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
};

test.describe('analytics', () => {
  test('has a heading and explains what the page is for', async ({ authedPage: page }) => {
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(
      page.getByText('What you buy, what it costs, and where you buy it.')
    ).toBeVisible();
  });

  test('always settles on a real state, never a crash or a spinner', async ({
    authedPage: page,
  }) => {
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });

    // Specs share one account and run in parallel, so whether any purchase
    // history exists yet depends on ordering. Either state is correct; a
    // half-rendered page or the error boundary is not.
    await expect(page.locator('.shopping-patterns, .shopping-patterns__intro')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflows).toBe(false);
  });

  test('turns a real purchase into charts and a table', async ({ authedPage: page }) => {
    const name = `Analytics Oats ${Date.now()}`;

    // Bought twice, in two shops. Two reasons: it is the case worth proving —
    // the same ingredient in two places is one shopping habit — and the chart
    // only shows the eight most-bought items, so an item on one purchase can
    // honestly fall off the end of a shared account that other specs keep
    // adding to. Two purchases puts it above everything bought once.
    await addPricedItem(page, { name, price: 6.5, store: 'Aldi' });
    await addPricedItem(page, { name, price: 5.5, store: 'Costco' });

    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Bought most often' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Your regulars' })).toBeVisible();

    // The charts are real SVG, not a placeholder image.
    await expect(page.locator('.recharts-surface').first()).toBeVisible();

    const regulars = page.locator('.frequent-items__table');
    await expect(regulars).toContainText(name);

    // Counted as two purchases of one thing, not two things — and the cheaper
    // of the two shops is named.
    const row = regulars.getByRole('row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('2 times');
    await expect(row).toContainText('Costco');
  });

  test('offers every chart as a table for anyone who cannot read it', async ({
    authedPage: page,
  }) => {
    const name = `Analytics Rice ${Date.now()}`;
    await addPricedItem(page, { name, price: 3.25, store: 'Costco' });

    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Bought most often' })).toBeVisible({
      timeout: 20_000,
    });

    // Every chart carries its own <details>; open the first and read it there.
    // Scoped, because the visible "Your regulars" table repeats these headers.
    const disclosure = page.locator('.chart-frame__table').first();
    await disclosure.getByText('View as table').click();

    await expect(disclosure.getByRole('columnheader', { name: 'Item' })).toBeVisible();

    // Rows, with the numbers the plot draws — not just a header. Deliberately
    // not "and mine is one of them": the chart shows the eight most-bought
    // items, and specs share one account, so by the time this runs the item it
    // just added may honestly rank ninth. That the table exists, opens and
    // carries the chart's data is what this spec is for; `.frequent-items__table`
    // below is where a specific item is checked.
    await expect(disclosure.getByRole('rowheader').first()).toBeVisible();
    await expect(disclosure.getByRole('cell').first()).toContainText(/\d/);
  });

  test('opens a chart table from the keyboard alone', async ({ authedPage: page }) => {
    // The plot itself is aria-hidden, so the table is the only way a keyboard
    // or screen-reader user reads the numbers. A summary that can only be
    // clicked would put them behind a mouse.
    const name = `Analytics Lentils ${Date.now()}`;
    await addPricedItem(page, { name, price: 1.8, store: 'Aldi' });

    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Bought most often' })).toBeVisible({
      timeout: 20_000,
    });

    const disclosure = page.locator('.chart-frame__table').first();
    const summary = disclosure.locator('summary');

    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(disclosure).toHaveJSProperty('open', true);
    await expect(disclosure.getByRole('columnheader', { name: 'Item' })).toBeVisible();

    // And it closes again, so the page does not fill up with open tables.
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveJSProperty('open', false);
  });

  test('every chart offers its own table, none of them left behind', async ({
    authedPage: page,
  }) => {
    const name = `Analytics Barley ${Date.now()}`;
    await addPricedItem(page, { name, price: 4.4, store: 'Costco' });

    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Bought most often' })).toBeVisible({
      timeout: 20_000,
    });

    // Three charts render: bought most often, spend by month, spend by store.
    const plots = page.locator('.chart-frame__plot');
    const disclosures = page.locator('.chart-frame__table');

    await expect(plots).toHaveCount(3);
    await expect(disclosures).toHaveCount(3);

    // Each plot is hidden from assistive tech precisely because its table is not.
    for (let i = 0; i < 3; i += 1) {
      await expect(plots.nth(i)).toHaveAttribute('aria-hidden', 'true');
      await expect(disclosures.nth(i).locator('summary')).toBeVisible();
    }
  });

  test('is readable on a phone', async ({ authedPage: page }) => {
    const name = `Analytics Beans ${Date.now()}`;
    await addPricedItem(page, { name, price: 2.1, store: 'Aldi' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Bought most often' })).toBeVisible({
      timeout: 20_000,
    });

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );

    expect(overflows).toBe(false);
  });
});
