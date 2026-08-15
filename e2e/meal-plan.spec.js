// Planning the week end to end: put a meal on a day, let the planner fill a
// week, and tick dinner off — each one confirmed in Firestore, through the real
// security rules, not just on screen.

const { test, expect } = require('./fixtures');
const {
  mealPlanEntry,
  mealPlanWeek,
  seedMealPlanEntry,
  seedInventoryItem,
  inventoryItemById,
} = require('./firestore-admin');

/** `YYYY-MM-DD` in local time — the format meal plan entries use. */
const toDayKey = (date) => {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const shiftDayKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return toDayKey(date);
};

const TODAY = toDayKey(new Date());

/**
 * The Monday the board opens on — `startOfWeek` in src/hooks/useMealPlan.js
 * uses `(getDay() + 6) % 7`, so weeks run Monday to Sunday.
 *
 * Any spec that needs a day with a *next* day on the board uses this rather
 * than today: today is Sunday one run in seven, and Sunday has no next day.
 */
const weekMonday = () => {
  const now = new Date();
  return toDayKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  );
};

/** Poll Firestore until the entry exists, then hand it back. */
const storedEntry = async (recipeName) => {
  await expect
    .poll(async () => Boolean(await mealPlanEntry(recipeName)), {
      message: `waiting for "${recipeName}" to reach Firestore`,
      timeout: 10_000,
    })
    .toBe(true);
  return mealPlanEntry(recipeName);
};

/** Poll Firestore until the week document exists, then hand it back. */
const storedWeek = async (weekStart) => {
  await expect
    .poll(async () => Boolean(await mealPlanWeek(weekStart)), {
      message: `waiting for the ${weekStart} week document to reach Firestore`,
      timeout: 10_000,
    })
    .toBe(true);
  return mealPlanWeek(weekStart);
};

/**
 * Stub the AI planner at the network boundary.
 *
 * The callable posts to the functions emulator, which the E2E run does not
 * start — and a real call would cost money. The stub answers with the callable
 * envelope (`{ result: ... }`) and builds its days from the week the client
 * actually asked for, so the request is verified as well as the response.
 */
const stubPlanner = async (page, recipeNames) => {
  await page.unroute('**/generateMealPlan').catch(() => {});
  await page.route('**/generateMealPlan', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
        },
      });
      return;
    }

    const body = JSON.parse(route.request().postData() || '{}');
    const weekStart = body?.data?.weekStart;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        result: {
          warning: null,
          plan: {
            weekStart,
            model: 'claude-opus-5',
            degraded: false,
            entries: recipeNames.map((recipeName, index) => ({
              date: shiftDayKey(weekStart, index),
              mealType: 'dinner',
              recipeId: null,
              recipeName,
              servings: 2,
              usesIngredients: [],
              batchGroup: null,
              notes: '',
            })),
            shoppingList: [],
            batchCooking: [
              {
                group: 'roast',
                title: 'Roast both trays together',
                detail: 'Two dinners this week use the same oven temperature.',
                entryDates: [weekStart, shiftDayKey(weekStart, 1)],
              },
            ],
            notes: '',
          },
        },
      }),
    });
  });
};

test.describe('meal plan', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/meal-plan', { waitUntil: 'domcontentloaded' });
    await expect(authedPage.getByRole('heading', { name: 'Meal Plan' })).toBeVisible();
  });

  test('shows a week of days', async ({ authedPage: page }) => {
    await expect(page.getByTestId(`day-card-${TODAY}`)).toBeVisible();
    await expect(page.locator('[data-testid^="day-card-"]')).toHaveCount(7);
  });

  test('schedules a meal that reaches Firestore in the documented shape', async ({
    authedPage: page,
  }) => {
    // Unique per run: specs share one seeded account and run in parallel.
    const recipeName = `E2E Dinner ${Date.now()}`;

    const dayCard = page.getByTestId(`day-card-${TODAY}`);
    await dayCard.getByRole('button', { name: /Add a meal on/ }).click();

    const modal = page.locator('.modal.show');
    await expect(modal).toBeVisible();
    await modal.getByLabel('What are you cooking?').fill(recipeName);
    await modal.getByRole('button', { name: 'Add to plan' }).click();
    await expect(modal).not.toBeVisible();

    await expect(dayCard.getByText(recipeName)).toBeVisible();

    // On screen is not proof: a write that violates a security rule renders
    // locally just the same. Read it back from outside the browser.
    const stored = await storedEntry(recipeName);
    expect(stored).toMatchObject({
      date: TODAY,
      mealType: 'dinner',
      recipeName,
      servings: 2,
      status: 'planned',
      source: 'manual',
    });
    expect(stored.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stored.createdAt).toBeTruthy();
  });

  test('marks a meal cooked and takes its ingredients out of the kitchen', async ({
    authedPage: page,
  }) => {
    const stamp = Date.now();
    const ingredientName = `E2E Spinach ${stamp}`;
    // Deliberately not containing "Cooked": the remove button's label is
    // "Remove <recipe name>", and a substring match would make the button
    // lookup below ambiguous.
    const recipeName = `E2E Dinner To Make ${stamp}`;

    const itemId = await seedInventoryItem({ name: ingredientName, quantity: 3, unit: 'bag' });
    await seedMealPlanEntry({
      date: TODAY,
      recipeName,
      usesIngredients: [
        {
          name: ingredientName,
          normalized: ingredientName.toLowerCase(),
          quantity: 2,
          unit: 'bag',
        },
      ],
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const meal = page.locator('[data-testid^="meal-entry-"]').filter({ hasText: recipeName });
    await expect(meal).toBeVisible();

    await meal.getByRole('button', { name: 'Cooked', exact: true }).click();

    await expect
      .poll(async () => (await mealPlanEntry(recipeName))?.status, { timeout: 10_000 })
      .toBe('cooked');

    // The point of the feature: the kitchen knows the food was eaten.
    await expect
      .poll(async () => (await inventoryItemById(itemId))?.quantity, { timeout: 10_000 })
      .toBe(1);

    // The inventory rules pin addedAt — a decrement that rewrote it would be
    // rejected in production even though it renders fine here.
    const item = await inventoryItemById(itemId);
    expect(item.addedAt).toBeTruthy();
  });

  test('generates a week from the planner and stores it', async ({
    authedPage: page,
  }, testInfo) => {
    // Regenerating clears the previous AI plan for the same week, so each
    // project plans a different week and the two runs cannot delete each
    // other's entries.
    const weeksAhead = testInfo.project.name === 'mobile-chromium' ? 2 : 1;
    const stamp = Date.now();
    const recipeNames = [`E2E Planned A ${stamp}`, `E2E Planned B ${stamp}`];

    await stubPlanner(page, recipeNames);

    for (let i = 0; i < weeksAhead; i += 1) {
      await page.getByRole('button', { name: 'Next week' }).click();
    }

    await page.getByRole('button', { name: /Generate plan/ }).click();

    await expect(page.getByText(recipeNames[0])).toBeVisible();
    await expect(page.getByText(recipeNames[1])).toBeVisible();

    const stored = await storedEntry(recipeNames[0]);
    expect(stored).toMatchObject({ status: 'planned', source: 'ai', servings: 2 });
    expect(stored.planId).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 7.3 — the batch cooking tip the planner returned is shown to the cook.
    await expect(page.getByText('Roast both trays together')).toBeVisible();
  });

  test('moves a meal to another day', async ({ authedPage: page }) => {
    const recipeName = `E2E Movable ${Date.now()}`;

    // Monday and Tuesday of the week the board already shows, rather than
    // today and tomorrow. Today is Sunday one run in seven, and Sunday is the
    // last card on the board — so this spec used to skip itself one day in
    // seven, silently, which is the same as not having it on those days.
    // Monday always has a Tuesday next to it.
    const monday = weekMonday();
    const tuesday = shiftDayKey(monday, 1);

    await seedMealPlanEntry({ date: monday, recipeName });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const meal = page.locator('[data-testid^="meal-entry-"]').filter({ hasText: recipeName });
    await expect(meal).toBeVisible();

    // Both days are on the board every day of the week — no conditional skip.
    await expect(page.getByTestId(`day-card-${monday}`)).toHaveCount(1);
    await expect(page.getByTestId(`day-card-${tuesday}`)).toHaveCount(1);

    await meal.getByRole('combobox').selectOption(tuesday);

    await expect
      .poll(async () => (await mealPlanEntry(recipeName))?.date, { timeout: 10_000 })
      .toBe(tuesday);
  });
  test('regenerates a week it has already planned', async ({ authedPage: page }, testInfo) => {
    // The emulator runs the real firestore.rules, and `mealPlans` pins
    // createdAt on update. A regeneration that re-stamps it is refused here
    // even though production's test mode would wave it through today.
    const weeksAhead = testInfo.project.name === 'mobile-chromium' ? 4 : 3;
    const stamp = Date.now();
    const first = [`E2E First Plan ${stamp}`];
    const second = [`E2E Second Plan ${stamp}`];

    for (let i = 0; i < weeksAhead; i += 1) {
      await page.getByRole('button', { name: 'Next week' }).click();
    }

    await stubPlanner(page, first);
    await page.getByRole('button', { name: /Generate plan/ }).click();
    await expect(page.getByText(first[0])).toBeVisible();

    const stored = await storedEntry(first[0]);
    const weekStart = stored.planId;
    // generatePlan writes the entries first and the week document after, so
    // an entry landing does not mean the week has.
    const created = (await storedWeek(weekStart)).createdAt;
    expect(created).toBeTruthy();

    // The button says "Regenerate plan" once the week document exists.
    await expect(page.getByRole('button', { name: /Regenerate plan/ })).toBeVisible();

    await stubPlanner(page, second);
    await page.getByRole('button', { name: /Regenerate plan/ }).click();

    await expect(page.getByText(second[0])).toBeVisible();
    await expect(page.getByText(first[0])).toHaveCount(0);

    // Read it back from outside the browser: the second write went through the
    // rules, and the week kept the creation date it started with.
    const replanned = await storedEntry(second[0]);
    expect(replanned).toMatchObject({ source: 'ai', status: 'planned', planId: weekStart });

    const week = await storedWeek(weekStart);
    expect(week.createdAt.toMillis()).toBe(created.toMillis());
    expect(week.weekStart).toBe(weekStart);
  });

  test('does not empty the kitchen twice for one dinner', async ({ authedPage: page }) => {
    const stamp = Date.now();
    const ingredientName = `E2E Rice ${stamp}`;
    const recipeName = `E2E Dinner Once Only ${stamp}`;

    const itemId = await seedInventoryItem({ name: ingredientName, quantity: 5, unit: 'cup' });
    await seedMealPlanEntry({
      date: TODAY,
      recipeName,
      usesIngredients: [
        {
          name: ingredientName,
          normalized: ingredientName.toLowerCase(),
          quantity: 2,
          unit: 'cup',
        },
      ],
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const meal = page.locator('[data-testid^="meal-entry-"]').filter({ hasText: recipeName });
    await expect(meal).toBeVisible();

    await meal.getByRole('button', { name: 'Cooked', exact: true }).click();

    await expect
      .poll(async () => (await inventoryItemById(itemId))?.quantity, { timeout: 10_000 })
      .toBe(3);

    // Once cooked, there is no second button to press — and the quantity stays
    // where the first click left it rather than sliding to 1.
    await expect(meal.getByText('Cooked')).toBeVisible();
    await expect(meal.getByRole('button', { name: 'Cooked', exact: true })).toHaveCount(0);

    await page.waitForTimeout(1000);
    expect((await inventoryItemById(itemId)).quantity).toBe(3);
  });

  test('keeps a cooked meal removable', async ({ authedPage: page }) => {
    const recipeName = `E2E Mislogged ${Date.now()}`;

    await seedMealPlanEntry({ date: TODAY, recipeName });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const meal = page.locator('[data-testid^="meal-entry-"]').filter({ hasText: recipeName });
    await meal.getByRole('button', { name: 'Cooked', exact: true }).click();
    await expect(meal.getByText('Cooked')).toBeVisible();

    // Ticking off the wrong meal used to leave a card with no way off the board.
    await meal.getByRole('button', { name: `Remove ${recipeName}` }).click();

    await expect
      .poll(async () => Boolean(await mealPlanEntry(recipeName)), { timeout: 10_000 })
      .toBe(false);
  });
});
