// The core loop the app exists for: see what's in the kitchen, add to it,
// and know what's about to go off. Exercised against real Firestore rules.

const { test, expect } = require('./fixtures');

/**
 * Fills and submits the add-item modal.
 *
 * The modal has two <select> elements (unit, then storage location) and several
 * number inputs, so every field is addressed by its own placeholder or label
 * rather than by position.
 */
const addItem = async (page, name, quantity = '1') => {
  await page
    .getByRole('button', { name: /add item/i })
    .first()
    .click();

  const modal = page.locator('.modal.show');
  await expect(modal).toBeVisible();

  await modal.getByPlaceholder(/Chicken Breast/).fill(name);
  await modal.getByPlaceholder('e.g. 2').fill(quantity);

  // Storage location is required; its <select> is the one containing the
  // "Select a location…" prompt.
  const locationSelect = modal.locator('select').filter({ hasText: 'Select a location' });
  const firstLocation = await locationSelect.locator('option').nth(1).getAttribute('value');
  await locationSelect.selectOption(firstLocation);

  await modal.getByRole('button', { name: 'Add Item' }).click();
  await expect(modal).not.toBeVisible();
};

/**
 * Re-reads the inventory in a brand new tab, which loads its own data from
 * Firestore rather than showing the writing tab's local state.
 *
 * A second tab rather than `page.reload()`: reloading immediately after a write
 * stalls indefinitely, because the service worker serves the navigation from
 * precache while the Firestore connection from the outgoing document is still
 * settling, and the new document never reaches DOMContentLoaded.
 */
const expectFreshClientToSee = async (page, itemName, shouldBeVisible) => {
  const fresh = await page.context().newPage();
  try {
    await fresh.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(fresh.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    if (shouldBeVisible) {
      await expect(fresh.getByText(itemName)).toBeVisible();
    } else {
      await expect(fresh.getByText(itemName)).not.toBeVisible();
    }
  } finally {
    await fresh.close();
  }
};

test.describe('inventory', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(authedPage.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  });

  test('lists the seeded items', async ({ authedPage: page }) => {
    await expect(page.getByText('Old Yogurt')).toBeVisible();
    await expect(page.getByText('Fresh Salmon')).toBeVisible();
    await expect(page.getByText('Basmati Rice')).toBeVisible();
  });

  test('colour-codes items by how soon they expire', async ({ authedPage: page }) => {
    // Scoped to card badges — the expiry filter dropdown contains <option>
    // elements with the same words.
    const badge = (label) => page.locator('.card .badge').filter({ hasText: label });

    await expect(badge('Expired').first()).toBeVisible();
    await expect(badge('Critical').first()).toBeVisible();
    await expect(badge('Fresh').first()).toBeVisible();
  });

  test('filters the list by search term', async ({ authedPage: page }) => {
    await page.getByPlaceholder('Search items…').fill('salmon');

    await expect(page.getByText('Fresh Salmon')).toBeVisible();
    await expect(page.getByText('Basmati Rice')).not.toBeVisible();
  });

  test('adds an item that persists for a fresh client', async ({ authedPage: page }) => {
    // Unique per run: specs share one seeded account and run in parallel.
    const itemName = `Test Butter ${Date.now()}`;

    await addItem(page, itemName, '2');

    await expect(page.getByText(itemName)).toBeVisible();
    // A write that passes client validation but violates a security rule still
    // renders locally, so confirm from a client that never saw the local write.
    await expectFreshClientToSee(page, itemName, true);
  });

  test('deletes an item after confirmation', async ({ authedPage: page }) => {
    const itemName = `Doomed Item ${Date.now()}`;

    await addItem(page, itemName);
    await expect(page.getByText(itemName)).toBeVisible();

    const card = page.locator('.card', { hasText: itemName });
    await card.getByRole('button').last().click();

    const confirm = page.locator('.modal.show');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /^delete$/i }).click();

    await expect(page.getByText(itemName)).not.toBeVisible();
    await expectFreshClientToSee(page, itemName, false);
  });
});
