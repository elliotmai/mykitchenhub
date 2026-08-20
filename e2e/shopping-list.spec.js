// Adding something to the shopping list that no recipe asked for.
//
// The rest of that list is derived: buildShoppingList() computes it from the
// week's meals minus the kitchen and stores nothing, so it cannot survive a
// reload and there is nothing to tick. These specs are about the half that has
// documents behind it — every assertion is confirmed in Firestore, through the
// real security rules, not just on screen.

const { test, expect } = require('./fixtures');
const { shoppingItem, shoppingItems, seedMealPlanEntry } = require('./firestore-admin');

/** `YYYY-MM-DD` in local time — the format meal plan entries use. */
const toDayKey = (date) => {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const TODAY = toDayKey(new Date());

/** Poll Firestore until the item exists, then hand it back. */
const storedItem = async (name) => {
  await expect
    .poll(async () => Boolean(await shoppingItem(name)), {
      message: `waiting for "${name}" to reach Firestore`,
      timeout: 10_000,
    })
    .toBe(true);
  return shoppingItem(name);
};

/**
 * Type an item into the panel and wait for it to land in the database.
 *
 * Returns only once the write has settled, which is also what makes a reload
 * safe afterwards: a navigation issued while a Firestore write is still in
 * flight is the case that hangs rather than fails (see TESTING.md).
 */
const addItem = async (page, { name, quantity, unit }) => {
  await page.getByLabel('Add something to the shopping list').fill(name);
  if (quantity !== undefined) await page.getByLabel('How many').fill(String(quantity));
  if (unit !== undefined) await page.getByLabel('Unit').fill(unit);
  await page.getByRole('button', { name: /^Add$/ }).click();

  // `.first()` because this helper is also used for the duplicate case, where
  // the same name is deliberately on both halves of the list — a bare
  // getByText would then resolve to two elements and fail strict mode for a
  // reason that has nothing to do with whether the add worked.
  await expect(page.getByText(name).first()).toBeVisible();
  return storedItem(name);
};

test.describe('manual shopping list items', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/meal-plan', { waitUntil: 'domcontentloaded' });
    await expect(authedPage.getByRole('heading', { name: 'Meal Plan' })).toBeVisible();
  });

  test('adds an item no recipe asked for, in the documented shape', async ({
    authedPage: page,
  }) => {
    // Unique per run: a worker's account is reused across the specs in it.
    const name = `E2E Batteries ${Date.now()}`;

    const stored = await addItem(page, { name });

    expect(stored).toMatchObject({
      name,
      normalized: name.toLowerCase(),
      quantity: 1,
      unit: '',
      status: 'pending',
      source: 'manual',
      boughtAt: null,
    });
    expect(stored.createdAt).toBeTruthy();

    // The fields that belong to a derived row and not to this one. A `false`
    // here would claim a needed-versus-on-hand comparison was made, and for
    // batteries there is nothing to compare.
    expect(stored).not.toHaveProperty('haveInInventory');
    expect(stored).not.toHaveProperty('onHand');
    // Not week-bound: nothing ties it to the week it was typed in.
    expect(stored).not.toHaveProperty('weekId');
  });

  test('keeps the quantity and unit a cook typed', async ({ authedPage: page }) => {
    const name = `E2E Milk ${Date.now()}`;

    const stored = await addItem(page, { name, quantity: 2, unit: 'l' });

    expect(stored).toMatchObject({ quantity: 2, unit: 'l' });
    await expect(page.getByText('2 l')).toBeVisible();
  });

  test('survives a reload — the derived half of the list cannot', async ({ authedPage: page }) => {
    const name = `E2E Kitchen Roll ${Date.now()}`;
    await addItem(page, { name });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Meal Plan' })).toBeVisible();

    // Rendered from the database this time, not from the state the form left
    // behind — which is the entire point of the collection.
    await expect(page.getByText(name)).toBeVisible();
  });

  test('does not vanish when the week rolls over', async ({ authedPage: page }) => {
    // A derived row belongs to the week whose meals produced it. "Buy batteries"
    // does not, so moving the board must not take it off the list.
    const name = `E2E Bin Bags ${Date.now()}`;
    await addItem(page, { name });

    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByText(name)).toBeVisible();

    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByText(name)).toBeVisible();

    await page.getByRole('button', { name: 'This week' }).click();
    await expect(page.getByText(name)).toBeVisible();
  });

  test('ticks an item off without deleting it, and puts it back', async ({ authedPage: page }) => {
    const name = `E2E Birthday Cake ${Date.now()}`;
    await addItem(page, { name });

    await page.getByRole('checkbox', { name: `Tick ${name} off` }).click();

    await expect
      .poll(async () => (await shoppingItem(name))?.status, { timeout: 10_000 })
      .toBe('bought');

    // Marked, not removed — a mis-tap in a shop has to be undoable.
    const bought = await shoppingItem(name);
    expect(bought).toBeTruthy();
    expect(bought.boughtAt).toBeTruthy();
    expect(bought.createdAt).toBeTruthy();
    await expect(page.getByText('In the trolley')).toBeVisible();

    await page.getByRole('checkbox', { name: `Put ${name} back on the list` }).click();

    await expect
      .poll(async () => (await shoppingItem(name))?.status, { timeout: 10_000 })
      .toBe('pending');
    expect((await shoppingItem(name)).boughtAt).toBeNull();
  });

  test('ticking off never restamps when the item was written down', async ({
    authedPage: page,
  }) => {
    // The emulator runs the real firestore.rules, which pin `createdAt` on
    // update. A tick that re-sent it would be refused here even though test
    // mode would wave it through in production today.
    const name = `E2E Foil ${Date.now()}`;
    const stored = await addItem(page, { name });
    const writtenDown = stored.createdAt;

    await page.getByRole('checkbox', { name: `Tick ${name} off` }).click();

    await expect
      .poll(async () => (await shoppingItem(name))?.status, { timeout: 10_000 })
      .toBe('bought');
    expect((await shoppingItem(name)).createdAt.toMillis()).toBe(writtenDown.toMillis());
  });

  test('clears the trolley, leaving what is still to buy', async ({ authedPage: page }) => {
    const stamp = Date.now();
    const boughtName = `E2E Sponges ${stamp}`;
    const keptName = `E2E Washing Up Liquid ${stamp}`;

    await addItem(page, { name: keptName });
    await addItem(page, { name: boughtName });

    await page.getByRole('checkbox', { name: `Tick ${boughtName} off` }).click();
    await expect
      .poll(async () => (await shoppingItem(boughtName))?.status, { timeout: 10_000 })
      .toBe('bought');

    await page.getByRole('button', { name: 'Clear' }).click();

    await expect
      .poll(async () => Boolean(await shoppingItem(boughtName)), { timeout: 10_000 })
      .toBe(false);
    // The one still to buy is untouched — "clear" means the trolley, not the list.
    expect(await shoppingItem(keptName)).toBeTruthy();
    await expect(page.getByText(keptName)).toBeVisible();
  });

  test('removes an item outright', async ({ authedPage: page }) => {
    const name = `E2E Cling Film ${Date.now()}`;
    await addItem(page, { name });

    await page.getByRole('button', { name: `Remove ${name}` }).click();

    await expect
      .poll(async () => Boolean(await shoppingItem(name)), { timeout: 10_000 })
      .toBe(false);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test('shows a typed item and the week’s own line for it, without merging them', async ({
    authedPage: page,
  }) => {
    // Merging is not obviously right: the typed quantity means "a bottle" and
    // the derived one came out of a recipe in grams, so one number cannot be
    // both. The list shows two lines and says they are the same thing.
    const stamp = Date.now();
    const ingredient = `E2E Cream ${stamp}`;

    await seedMealPlanEntry({
      date: TODAY,
      recipeName: `E2E Creamy Dinner ${stamp}`,
      usesIngredients: [
        { name: ingredient, normalized: ingredient.toLowerCase(), quantity: 200, unit: 'g' },
      ],
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('200 g')).toBeVisible();

    await addItem(page, { name: ingredient });

    await expect(page.getByText(ingredient)).toHaveCount(2);
    await expect(page.getByText(/this week’s meals need it too/)).toBeVisible();
    // The derived line keeps the quantity it was computed with.
    await expect(page.getByText('200 g')).toBeVisible();
  });

  test('gives no tick to a line the week computed', async ({ authedPage: page }) => {
    // A derived row has no document, so there is nowhere to record that it was
    // bought — and creating one on a tick would make the same list true in two
    // places. No checkbox is the honest answer, and nothing must appear in the
    // collection as a side effect of the row being on screen.
    const stamp = Date.now();
    const ingredient = `E2E Paprika ${stamp}`;

    await seedMealPlanEntry({
      date: TODAY,
      recipeName: `E2E Spiced Dinner ${stamp}`,
      usesIngredients: [
        { name: ingredient, normalized: ingredient.toLowerCase(), quantity: 3, unit: 'tsp' },
      ],
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(ingredient)).toBeVisible();

    const derivedRow = page.locator('li').filter({ hasText: ingredient });
    await expect(derivedRow.getByRole('checkbox')).toHaveCount(0);

    // And no document appeared for it.
    const stored = await shoppingItems();
    expect(stored.some((item) => item.name === ingredient)).toBe(false);
  });

  test('refuses a line with no name, without spending a write', async ({ authedPage: page }) => {
    const before = (await shoppingItems()).length;

    const add = page.getByRole('button', { name: /^Add$/ });
    await expect(add).toBeDisabled();

    await page.getByLabel('Add something to the shopping list').fill('   ');
    await expect(add).toBeDisabled();

    expect((await shoppingItems()).length).toBe(before);
  });
});
