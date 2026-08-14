// HelloFresh import and delivery, against a real production build and real
// Firestore security rules.
//
// The Cloud Functions are NOT running in this suite (the emulator set is
// auth + firestore only), so the AI response is stubbed at the network
// boundary with page.route — a real Claude Vision call would cost money and
// would not be deterministic. Everything downstream of that stub is real:
// the browser writes the recipe, the inventory items, and the meal plan under
// the signed-in user's own credentials, so the security rules are exercised.

const { test, expect } = require('./fixtures');
const {
  deliveries,
  hellofreshRecipes,
  inventoryItems,
  mealPlanEntries,
} = require('./firestore-admin');

const PHOTO_ROUTE = '**/importHelloFreshFromPhoto';
const URL_ROUTE = '**/importHelloFreshFromUrl';

const RECIPE_URL = 'https://www.hellofresh.com/recipes/e2e-test-recipe-123';

/** A draft in the exact shape the Cloud Function returns. */
const draftFor = (name) => ({
  status: 'success',
  needsReview: true,
  warnings: [],
  recipe: {
    name,
    ingredients: [
      { name: 'Chicken Breast', quantity: 2, unit: 'unit', normalized: 'chicken breast' },
      { name: 'Tomato Paste', quantity: 28, unit: 'g', normalized: 'tomato paste' },
    ],
    instructions: ['Preheat the oven to 425F.', 'Roast the chicken for 20 minutes.'],
    source: 'hellofresh',
    tags: ['hellofresh', 'chicken'],
    prepTime: 10,
    cookTime: 25,
    servings: 2,
    difficulty: 'medium',
    timesCooked: 0,
    imageUrl: null,
    sourceUrl: null,
  },
});

/** Stub an import function at the network boundary. */
const stubImport = (page, pattern, body, status = 200) =>
  page.route(pattern, (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  });

/**
 * The emulators inject a fixed banner across the bottom of the page. On a phone
 * viewport it sits over the modal's footer buttons and swallows the click, so
 * hide it — it is emulator furniture, not part of the app under test.
 */
const hideEmulatorBanner = (page) =>
  page.addStyleTag({ content: '.firebase-emulator-warning { display: none !important; }' });

/**
 * Confirm a write from outside the browser. A write that passes client
 * validation but violates a security rule still renders locally, so reading it
 * back from the emulator is the only proof it was accepted.
 */
const expectStored = async (read, name, shouldExist = true) => {
  await expect
    .poll(async () => (await read()).some((doc) => doc.name === name), {
      message: `waiting for "${name}" to ${shouldExist ? 'reach' : 'leave'} Firestore`,
      timeout: 10_000,
    })
    .toBe(shouldExist);
};

test.describe('hellofresh import', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/hellofresh', { waitUntil: 'domcontentloaded' });
    await expect(
      authedPage.getByRole('heading', { name: 'HelloFresh', exact: true })
    ).toBeVisible();
  });

  test('imports a recipe from a link and stores it in the documented shape', async ({
    authedPage: page,
  }) => {
    // Specs share one account and run in parallel, so the name must be unique.
    const name = `E2E Link Recipe ${Date.now()}`;
    await stubImport(page, URL_ROUTE, draftFor(name));

    await page.getByRole('tab', { name: /link/i }).click();
    await page.getByLabel(/hellofresh recipe link/i).fill(RECIPE_URL);
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    // The AI's read goes to review, not straight to the database.
    await expect(page.getByText(/check this over before saving/i)).toBeVisible();
    expect((await hellofreshRecipes()).some((recipe) => recipe.name === name)).toBe(false);

    await page.getByRole('button', { name: /save recipe/i }).click();
    await expectStored(hellofreshRecipes, name);

    const stored = (await hellofreshRecipes()).find((recipe) => recipe.name === name);
    // Exactly the fields firestore.rules requires on a recipes create.
    expect(stored).toMatchObject({
      name,
      source: 'hellofresh',
      difficulty: 'medium',
      servings: 2,
      timesCooked: 0,
    });
    expect(Array.isArray(stored.ingredients)).toBe(true);
    expect(stored.ingredients.length).toBeGreaterThan(0);
    expect(Array.isArray(stored.instructions)).toBe(true);
    expect(stored.tags).toContain('hellofresh');
    expect(stored.createdAt).toBeTruthy();
  });

  test('imports a recipe from a photo of the card', async ({ authedPage: page }) => {
    const name = `E2E Photo Recipe ${Date.now()}`;
    await stubImport(page, PHOTO_ROUTE, draftFor(name));

    // A 1x1 PNG is enough — the AI response is stubbed, not the image content.
    await page.getByTestId('photo-input').setInputFiles({
      name: 'card.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      ),
    });

    await expect(page.getByText(/check this over before saving/i)).toBeVisible();
    await page.getByRole('button', { name: /save recipe/i }).click();

    await expectStored(hellofreshRecipes, name);
  });

  test('lets the cook correct what the AI misread before saving', async ({ authedPage: page }) => {
    const aiName = `E2E Misread ${Date.now()}`;
    const correctedName = `${aiName} Corrected`;
    await stubImport(page, URL_ROUTE, draftFor(aiName));

    await page.getByRole('tab', { name: /link/i }).click();
    await page.getByLabel(/hellofresh recipe link/i).fill(RECIPE_URL);
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByText(/check this over before saving/i)).toBeVisible();
    await page.getByLabel(/recipe name/i).fill(correctedName);
    await page.locator('#ingredient-name-0').fill('Chicken Thighs');
    await page.getByRole('button', { name: /save recipe/i }).click();

    await expectStored(hellofreshRecipes, correctedName);

    const stored = (await hellofreshRecipes()).find((recipe) => recipe.name === correctedName);
    expect(stored.ingredients[0].name).toBe('Chicken Thighs');
    // The normalised name follows the edit, so inventory matching still works.
    expect(stored.ingredients[0].normalized).toBe('chicken thighs');
  });

  test('explains a photo it could not read instead of failing silently', async ({
    authedPage: page,
  }) => {
    await stubImport(
      page,
      PHOTO_ROUTE,
      {
        status: 'error',
        code: 'unreadable-image',
        message: 'That photo was too hard to read.',
        details: ['Glare over the ingredients panel.'],
      },
      422
    );

    await page.getByTestId('photo-input').setInputFiles({
      name: 'blurry.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      ),
    });

    await expect(page.getByText('That photo was too hard to read.')).toBeVisible();
    await expect(page.getByText('Glare over the ingredients panel.')).toBeVisible();
    await expect(page.getByText(/more light/i)).toBeVisible();
    // Nothing half-saved, and the manual route is still offered.
    await expect(page.getByText(/check this over before saving/i)).toBeHidden();
    await expect(page.getByRole('button', { name: /enter it by hand/i })).toBeVisible();
  });

  test('falls back to entering a recipe by hand', async ({ authedPage: page }) => {
    const name = `E2E Manual Recipe ${Date.now()}`;

    await page.getByRole('tab', { name: /by hand/i }).click();
    await page.getByRole('button', { name: /start a blank recipe/i }).click();

    await expect(page.getByText(/check this over before saving/i)).toBeVisible();
    await page.getByLabel(/recipe name/i).fill(name);
    await page.locator('#ingredient-name-0').fill('Chicken Breast');
    await page.locator('#ingredient-qty-0').fill('2');
    await page.locator('#step-0').fill('Roast until cooked through.');
    await page.getByRole('button', { name: /save recipe/i }).click();

    await expectStored(hellofreshRecipes, name);
  });

  test('refuses to save a recipe the security rules would reject', async ({ authedPage: page }) => {
    await page.getByRole('tab', { name: /by hand/i }).click();
    await page.getByRole('button', { name: /start a blank recipe/i }).click();
    await page.getByRole('button', { name: /save recipe/i }).click();

    await expect(page.getByText(/give the recipe a name/i)).toBeVisible();
    await expect(page.getByText(/add at least one ingredient/i)).toBeVisible();
    // Still on the review form — nothing was written.
    await expect(page.getByText(/check this over before saving/i)).toBeVisible();
  });
});

test.describe('hellofresh deliveries', () => {
  test('logs a delivery into inventory, the meal plan, and the history', async ({
    authedPage: page,
  }) => {
    const recipeName = `E2E Delivery Recipe ${Date.now()}`;
    const ingredientName = `E2E Box Ingredient ${Date.now()}`;

    await page.goto('/hellofresh', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'HelloFresh', exact: true })).toBeVisible();
    await hideEmulatorBanner(page);

    // Import a recipe so the delivery picker has something in it.
    const draft = draftFor(recipeName);
    draft.recipe.ingredients = [
      {
        name: ingredientName,
        quantity: 2,
        unit: 'unit',
        normalized: ingredientName.toLowerCase(),
      },
    ];
    await stubImport(page, URL_ROUTE, draft);

    await page.getByRole('tab', { name: /link/i }).click();
    await page.getByLabel(/hellofresh recipe link/i).fill(RECIPE_URL);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: /save recipe/i }).click();
    await expectStored(hellofreshRecipes, recipeName);

    // Now log the box it came in.
    await page.getByRole('button', { name: /add delivery/i }).click();

    const modal = page.locator('.modal.show');
    await expect(modal).toBeVisible();
    await modal.getByRole('checkbox', { name: new RegExp(recipeName) }).check();
    await expect(modal.getByText(/here.s what will happen/i)).toBeVisible();
    await modal.getByRole('button', { name: /add delivery/i }).click();
    await expect(modal).toBeHidden();

    // The ingredient reached the fridge in the shape the inventory rules demand.
    await expectStored(inventoryItems, ingredientName);
    const item = (await inventoryItems()).find((doc) => doc.name === ingredientName);
    expect(item).toMatchObject({
      source: 'hellofresh',
      locationType: expect.stringMatching(/^(fridge|freezer|pantry)$/),
    });
    expect(item.quantity).toBeGreaterThan(0);
    expect(item.expiresAt).toBeTruthy();
    expect(item.addedAt).toBeTruthy();
    expect(item.locationId).toBeTruthy();

    // The meal was scheduled, and the delivery recorded.
    await expect
      .poll(async () => (await mealPlanEntries()).some((meal) => meal.recipeName === recipeName), {
        timeout: 10_000,
      })
      .toBe(true);

    const meal = (await mealPlanEntries()).find((entry) => entry.recipeName === recipeName);
    expect(meal).toMatchObject({ mealType: 'dinner', source: 'hellofresh', status: 'planned' });
    expect(meal.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meal.servings).toBeGreaterThan(0);

    const delivery = (await deliveries()).find((doc) =>
      (doc.recipeNames ?? []).includes(recipeName)
    );
    expect(delivery).toMatchObject({ source: 'hellofresh', status: 'received' });
    expect(delivery.itemsAdded).toBeGreaterThan(0);

    // And it shows up in the history on the page.
    await expect(page.getByText(recipeName).first()).toBeVisible();
  });
});
