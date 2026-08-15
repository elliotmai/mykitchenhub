// The recipe loop, against a real build, real emulators and the real security
// rules: browse the library, add a recipe, edit it, cook it, delete it.
//
// Every write is read back from Firestore rather than trusted from the screen.
// The UI renders its own writes optimistically, so a recipe that violates a
// rule looks identical on screen until you read it back from outside the
// browser — and the recipes rules are strict about `name`, `source` and the
// fields that must be present.

const { test, expect } = require('./fixtures');
const { recipesHaveRecipe, recipeByName } = require('./firestore-admin');

/** Fills and submits the Add Recipe modal. */
const addRecipe = async (page, name, { servings = '2' } = {}) => {
  await page.getByRole('button', { name: 'Add Recipe' }).first().click();

  const modal = page.locator('.modal.show');
  await expect(modal).toBeVisible();

  await modal.getByPlaceholder('e.g. Sheet Pan Salmon').fill(name);
  await modal.getByLabel('Servings', { exact: true }).fill(servings);
  await modal.getByLabel('Ingredient 1 name', { exact: true }).fill('salmon');
  await modal.getByLabel('Ingredient 1 quantity', { exact: true }).fill('2');
  await modal.getByLabel('Step 1', { exact: true }).fill('Roast at 220C for 15 minutes.');
  await modal.getByLabel('Add a tag', { exact: true }).fill('weeknight');
  await modal.getByLabel('Add a tag', { exact: true }).press('Enter');

  await modal.getByRole('button', { name: 'Add Recipe' }).click();
  await expect(modal).not.toBeVisible();
};

/** Asserts whether a recipe reached Firestore, read straight from the emulator. */
const expectStoredInFirestore = async (name, shouldExist) => {
  await expect
    .poll(() => recipesHaveRecipe(name), {
      message: `waiting for "${name}" to ${shouldExist ? 'appear in' : 'disappear from'} Firestore`,
      timeout: 10_000,
    })
    .toBe(shouldExist);
};

/** The card for a named recipe. */
const cardFor = (page, name) => page.locator('.recipe-card').filter({ hasText: name });

test.describe('recipes', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/recipes', { waitUntil: 'domcontentloaded' });
    await expect(authedPage.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  });

  test('lists the seeded recipes', async ({ authedPage: page }) => {
    await expect(page.getByText('Seeded Sheet Pan Salmon')).toBeVisible();
    await expect(page.getByText('Seeded Grandma Chili')).toBeVisible();
  });

  test('filters the library by search term', async ({ authedPage: page }) => {
    await page.getByLabel('Search recipes').fill('chili');

    await expect(page.getByText('Seeded Grandma Chili')).toBeVisible();
    await expect(page.getByText('Seeded Sheet Pan Salmon')).not.toBeVisible();
  });

  test('opens a recipe into a shareable full view', async ({ authedPage: page }) => {
    await cardFor(page, 'Seeded Sheet Pan Salmon').getByRole('button', { name: 'View' }).click();

    await expect(page.getByRole('heading', { name: 'Seeded Sheet Pan Salmon' })).toBeVisible();
    await expect(page.getByText('Heat the oven to 220C.')).toBeVisible();
    // The detail view is deep-linkable rather than modal-only.
    await expect(page).toHaveURL(/\?recipe=/);
  });

  test('adds a recipe that reaches Firestore in the documented shape', async ({
    authedPage: page,
  }) => {
    // Unique per run: the recipe library is shared and specs run in parallel.
    const name = `E2E Test Recipe ${Date.now()}`;

    await addRecipe(page, name, { servings: '4' });

    await expect(page.getByText(name)).toBeVisible();
    await expectStoredInFirestore(name, true);

    const stored = await recipeByName(name);
    expect(stored).toMatchObject({
      name,
      source: 'user-created',
      servings: 4,
      difficulty: 'easy',
      timesCooked: 0,
    });
    expect(stored.ingredients[0]).toMatchObject({ name: 'salmon', normalized: 'salmon' });
    expect(stored.instructions).toEqual(['Roast at 220C for 15 minutes.']);
    expect(stored.tags).toContain('weeknight');
    expect(stored.createdAt).toBeTruthy();
  });

  test('records a cook, and the count survives a round trip', async ({ authedPage: page }) => {
    const name = `E2E Cooked Recipe ${Date.now()}`;

    await addRecipe(page, name);
    await expectStoredInFirestore(name, true);

    await cardFor(page, name)
      .getByRole('button', { name: `I cooked ${name}` })
      .click();

    await expect
      .poll(async () => (await recipeByName(name))?.timesCooked, { timeout: 10_000 })
      .toBe(1);
  });

  test('edits a recipe the cook added', async ({ authedPage: page }) => {
    const name = `E2E Edited Recipe ${Date.now()}`;

    await addRecipe(page, name, { servings: '2' });
    await expectStoredInFirestore(name, true);

    await cardFor(page, name)
      .getByRole('button', { name: `Edit ${name}` })
      .click();

    const modal = page.locator('.modal.show');
    await expect(modal).toBeVisible();
    // The rules forbid renaming, so the form locks the field rather than
    // letting the save bounce.
    await expect(modal.getByPlaceholder('e.g. Sheet Pan Salmon')).toBeDisabled();

    await modal.getByLabel('Servings', { exact: true }).fill('8');
    await modal.getByRole('button', { name: 'Save Changes' }).click();
    await expect(modal).not.toBeVisible();

    await expect
      .poll(async () => (await recipeByName(name))?.servings, { timeout: 10_000 })
      .toBe(8);
  });

  test('deletes a recipe after confirmation', async ({ authedPage: page }) => {
    const name = `E2E Doomed Recipe ${Date.now()}`;

    await addRecipe(page, name);
    await expectStoredInFirestore(name, true);

    await cardFor(page, name)
      .getByRole('button', { name: `Delete ${name}` })
      .click();

    const confirm = page.locator('.modal.show');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /^delete$/i }).click();

    // Wait for the dialog to actually go before looking for the recipe. Its own
    // message quotes the recipe name, so a page-wide getByText matches both the
    // card and the dialog asking about it — which fails on a strict-mode
    // violation rather than on anything being wrong.
    await expect(confirm).toBeHidden();

    await expect(cardFor(page, name)).toHaveCount(0);
    await expectStoredInFirestore(name, false);
  });

  // The rules only allow deleting `source: 'user-created'`, so the UI must not
  // offer a control that would always fail.
  test('offers no delete control on a recipe the cook did not add', async ({
    authedPage: page,
  }) => {
    const card = cardFor(page, 'Seeded Grandma Chili');

    await expect(card).toHaveCount(1);
    await expect(card.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  });

  test('shows the legacy sync dashboard without starting a sync', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: 'Legacy Sync' }).click();

    const modal = page.locator('.modal.show');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Legacy Recipe Sync')).toBeVisible();
    // A dry run is the default, so a stray click cannot spend money.
    await expect(modal.getByLabel(/dry run/i)).toBeChecked();
  });
});
