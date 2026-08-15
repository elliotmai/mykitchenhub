// The core loop the app exists for: see what's in the kitchen, add to it,
// and know what's about to go off. Exercised against real Firestore rules.

const { test, expect, addInventoryItem } = require('./fixtures');
const { inventoryHasItem, inventoryItem } = require('./firestore-admin');

/** Fills and submits the add-item modal, already on the inventory page. */
const addItem = (page, name, quantity = '1') =>
  addInventoryItem(page, { name, quantity, navigate: false });

/**
 * Asserts whether an item reached Firestore, read straight from the emulator.
 *
 * The UI renders its own writes optimistically, so an item on screen does not
 * prove the write was accepted — one that violates a security rule looks
 * identical until it's read back from outside the browser.
 */
const expectStoredInFirestore = async (itemName, shouldExist) => {
  await expect
    .poll(() => inventoryHasItem(itemName), {
      message: `waiting for "${itemName}" to ${shouldExist ? 'appear in' : 'disappear from'} Firestore`,
      timeout: 10_000,
    })
    .toBe(shouldExist);
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

  test('adds an item that reaches Firestore in the documented shape', async ({
    authedPage: page,
  }) => {
    // Unique per run: specs share one seeded account and run in parallel.
    const itemName = `Test Butter ${Date.now()}`;

    await addItem(page, itemName, '2');

    await expect(page.getByText(itemName)).toBeVisible();
    // A write that passes client validation but violates a security rule still
    // renders locally, so confirm it actually reached the database.
    await expectStoredInFirestore(itemName, true);

    // The fields the security rules require on create. `source` in particular
    // was previously written as `addedBy`, which the rules reject.
    const stored = await inventoryItem(itemName);
    expect(stored).toMatchObject({
      name: itemName,
      normalized: itemName.toLowerCase(),
      quantity: 2,
      locationType: expect.stringMatching(/^(fridge|freezer|pantry)$/),
      source: 'manual',
    });
    expect(stored.locationId).toBeTruthy();
    expect(stored.addedAt).toBeTruthy();
  });

  test('deletes an item after confirmation', async ({ authedPage: page }) => {
    const itemName = `Doomed Item ${Date.now()}`;

    await addItem(page, itemName);
    await expect(page.getByText(itemName)).toBeVisible();

    // Scoped to the item card itself (ItemCard renders `.card.h-100`); a bare
    // `.card` also matches any container wrapping the grid, and clicking the
    // "last button" across several matches deletes the wrong row.
    const card = page.locator('.card.h-100').filter({ hasText: itemName });
    await expect(card).toHaveCount(1);
    await card.getByRole('button').last().click();

    const confirm = page.locator('.modal.show');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /^delete$/i }).click();

    await expect(page.getByText(itemName)).not.toBeVisible();
    await expectStoredInFirestore(itemName, false);
  });
});
