// Shopping analytics against a real build and real emulators.
//
// The seeded items carry an empty purchaseHistory, so the page starts on its
// empty state. The first spec then adds a priced item through the real UI and
// checks the insights appear — which also proves the write survives the
// security rules, since a rejected write would never come back on the listener.

const { test, expect } = require('./fixtures');

/**
 * Adds an item through the real inventory UI, with a price and a store.
 *
 * Fields are addressed by placeholder: the modal's Form.Label elements are not
 * associated with their inputs via htmlFor, so getByLabel finds nothing.
 */
const addPricedItem = async (page, { name, price, store }) => {
  await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

  await page
    .getByRole('button', { name: /add item/i })
    .first()
    .click();

  const modal = page.locator('.modal.show');
  await expect(modal).toBeVisible();

  await modal.getByPlaceholder(/Chicken Breast/).fill(name);
  await modal.getByPlaceholder('e.g. 2').fill('2');
  await modal.getByPlaceholder('e.g. 8.99').fill(String(price));
  await modal
    .getByPlaceholder(/Costco/)
    .last()
    .fill(store);

  const locationSelect = modal.locator('select').filter({ hasText: 'Select a location' });
  const firstLocation = await locationSelect.locator('option').nth(1).getAttribute('value');
  await locationSelect.selectOption(firstLocation);

  await modal.getByRole('button', { name: 'Add Item' }).click();
  await expect(modal).not.toBeVisible();
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
    await addPricedItem(page, { name, price: 6.5, store: 'Aldi' });

    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Bought most often' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Your regulars' })).toBeVisible();

    // The charts are real SVG, not a placeholder image.
    await expect(page.locator('.recharts-surface').first()).toBeVisible();

    await expect(page.locator('.frequent-items__table')).toContainText(name);
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
    await expect(disclosure.getByRole('rowheader', { name })).toBeVisible();
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
