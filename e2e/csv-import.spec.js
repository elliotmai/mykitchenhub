// Bulk import: a spreadsheet of what is in the kitchen goes in, real inventory
// comes out. Run against the real security rules, because the rules are what
// reject an item tagged with the wrong `source`.

const { test, expect, chooseCSV, CSV_HEADER: HEADER } = require('./fixtures');
const { inventoryItemsNamed, importHistoryRecords } = require('./firestore-admin');

/** Waits for items to reach Firestore, read from outside the browser. */
const storedItems = async (prefix, expectedCount) => {
  await expect
    .poll(async () => (await inventoryItemsNamed(prefix)).length, {
      message: `waiting for ${expectedCount} imported items starting "${prefix}"`,
      timeout: 20_000,
    })
    .toBe(expectedCount);

  return inventoryItemsNamed(prefix);
};

test.describe('CSV import', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(authedPage.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  });

  test('previews a file, then imports the rows that are usable', async ({ authedPage: page }) => {
    // Specs share one seeded account and run in parallel, so names must be unique.
    const prefix = `CSV ${Date.now()}`;

    const modal = await chooseCSV(
      page,
      [
        HEADER,
        `${prefix} Butter,2,lbs,Main Fridge`,
        `${prefix} Peas,3,bags,freezer`,
        `,1,ea,Pantry`,
        `${prefix} Mystery,1,ea,Wine Cellar`,
      ].join('\n'),
      'january.csv'
    );

    // The preview separates what will import from what will not, before writing.
    await expect(modal.getByText('2 ready to import')).toBeVisible();
    await expect(modal.getByText('2 need fixing')).toBeVisible();
    await expect(modal.getByText('Missing item name.')).toBeVisible();
    await expect(modal.getByText('No storage location called "Wine Cellar".')).toBeVisible();

    await modal.getByRole('button', { name: 'Import 2 items' }).click();
    await expect(modal.getByText('2 items added to your kitchen.')).toBeVisible();

    // A write that passes client validation but violates a security rule still
    // renders locally, so confirm it actually reached the database.
    const stored = await storedItems(prefix, 2);
    const butter = stored.find((item) => item.name.endsWith('Butter'));

    expect(butter).toMatchObject({
      normalized: `${prefix.toLowerCase()} butter`,
      quantity: 2,
      unit: 'lbs',
      locationType: 'fridge',
      source: 'csv-import',
    });
    expect(butter.locationId).toBeTruthy();
    expect(butter.addedAt).toBeTruthy();

    // "freezer" in the location column resolves to the seeded Freezer.
    expect(stored.find((item) => item.name.endsWith('Peas')).locationType).toBe('freezer');

    // The run is logged, so the person can see what that file did later.
    await expect
      .poll(async () => (await importHistoryRecords()).some((r) => r.fileName === 'january.csv'), {
        timeout: 20_000,
      })
      .toBe(true);

    const record = (await importHistoryRecords()).find((r) => r.fileName === 'january.csv');
    expect(record).toMatchObject({
      itemsImported: 2,
      itemsSkipped: 2,
      status: 'completed',
      source: 'csv-import',
    });

    await modal.getByRole('button', { name: /done/i }).click();
    await expect(page.locator('.modal.show')).not.toBeVisible();

    // And the kitchen on screen now has them.
    await expect(page.getByText(`${prefix} Butter`)).toBeVisible();
  });

  test('imports a large file of 120 items', async ({ authedPage: page }) => {
    const prefix = `Bulk ${Date.now()}`;
    const rows = Array.from(
      { length: 120 },
      (_, i) => `${prefix} Item ${i},${i + 1},ea,${i % 2 ? 'Pantry' : 'Main Fridge'}`
    );

    const modal = await chooseCSV(page, [HEADER, ...rows].join('\n'), 'big-shop.csv');

    await expect(modal.getByText('120 ready to import')).toBeVisible();
    // Long files are summarised rather than listed row by row.
    await expect(modal.getByText('…and 95 more.')).toBeVisible();

    await modal.getByRole('button', { name: 'Import 120 items' }).click();
    await expect(modal.getByText('120 items added to your kitchen.')).toBeVisible({
      timeout: 30_000,
    });

    const stored = await storedItems(prefix, 120);
    expect(stored.every((item) => item.source === 'csv-import')).toBe(true);
    expect(stored.every((item) => item.quantity > 0)).toBe(true);
    expect(new Set(stored.map((item) => item.locationType))).toEqual(new Set(['fridge', 'pantry']));
  });

  test('explains a file it cannot use instead of importing nothing silently', async ({
    authedPage: page,
  }) => {
    const modal = await chooseCSV(page, 'fruit,howmany\napples,3', 'wrong-shape.csv');

    await expect(modal.getByText(/needs a name, quantity, location column/i)).toBeVisible();
    await expect(modal.getByRole('button', { name: /^Import \d/ })).toHaveCount(0);

    // The picker stays put and lets go of the file, so someone can fix the
    // spreadsheet and choose that same file again.
    const input = modal.getByLabel('Choose a CSV file');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('');
  });

  test('offers nothing to import when every row is broken', async ({ authedPage: page }) => {
    const prefix = `Doomed ${Date.now()}`;
    const modal = await chooseCSV(
      page,
      [HEADER, `${prefix},0,ea,Pantry`, `,1,ea,Main Fridge`, `${prefix} Jar,1,ea,Wine Cellar`].join(
        '\n'
      ),
      'all-bad.csv'
    );

    await expect(modal.getByText('0 ready to import')).toBeVisible();
    await expect(modal.getByText(/None of these rows can be imported yet/)).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Import 0 items' })).toBeDisabled();

    expect(await inventoryItemsNamed(prefix)).toHaveLength(0);
  });

  test('survives the messy file a real spreadsheet exports', async ({ authedPage: page }) => {
    // Blank lines between rows, a trailing comma, quoted commas, a location
    // typed with odd spacing, and an accent. Everything here used to either
    // reject a usable row or report the wrong line number.
    const prefix = `Messy ${Date.now()}`;
    const modal = await chooseCSV(
      page,
      [
        `${HEADER},notes`,
        `${prefix} Crème,1,tub,  main   fridge  ,"soft, ripe",`,
        '',
        '',
        `${prefix} Rice,5,lbs,Pantry,,`,
        '',
        `,1,ea,Pantry,,`,
      ].join('\r\n'),
      'messy.csv'
    );

    await expect(modal.getByText('2 ready to import')).toBeVisible();
    await expect(modal.getByText('1 needs fixing')).toBeVisible();

    // Line 7 is where the nameless row actually sits in the file.
    const skipped = modal.getByRole('table', { name: 'Rows we had to skip' });
    await expect(skipped.getByRole('cell', { name: '7', exact: true })).toBeVisible();

    await modal.getByRole('button', { name: 'Import 2 items' }).click();
    await expect(modal.getByText('2 items added to your kitchen.')).toBeVisible();

    const stored = await storedItems(prefix, 2);
    const creme = stored.find((item) => item.name.endsWith('Crème'));
    expect(creme).toMatchObject({ locationType: 'fridge', notes: 'soft, ripe', quantity: 1 });
    // Every imported item carries a shelf life, so editing it later cannot
    // quietly move its expiry date.
    stored.forEach((item) => expect(item.shelfLifeDays).toBeGreaterThan(0));
  });
});
