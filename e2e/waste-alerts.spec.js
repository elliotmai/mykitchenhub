// The waste alerts page against real emulators and real security rules.
//
// The freeze action is the one that matters most here: it is a write the UI
// renders optimistically, so the assertions read the item back out of
// Firestore rather than trusting the screen.

const { test, expect } = require('./fixtures');
const {
  inventoryItem,
  testUserId,
  seedRecipe,
  deleteRecipe,
  mealPlanEntry,
} = require('./firestore-admin');
const admin = require('firebase-admin');

/** `YYYY-MM-DD` in local time — the format meal plan entries key days on. */
const toDayKey = (date) => {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Adds an inventory item straight to the emulator, ready to be rescued. */
const seedItem = async (
  name,
  { daysUntilExpiry = 1, quantity = 4, locationType = 'fridge' } = {}
) => {
  const uid = await testUserId();
  const expires = new Date();
  expires.setDate(expires.getDate() + daysUntilExpiry);

  await admin
    .firestore()
    .collection(`users/${uid}/inventory`)
    .add({
      name,
      normalized: name.toLowerCase(),
      quantity,
      unit: 'lbs',
      locationId: locationType === 'fridge' ? 'loc-fridge' : 'loc-pantry',
      locationType,
      addedAt: admin.firestore.Timestamp.fromDate(new Date()),
      expiresAt: admin.firestore.Timestamp.fromDate(expires),
      shelfLifeDays: 7,
      shelfLifeSource: 'default',
      notes: '',
      source: 'seed',
      purchaseHistory: [],
      totalTimesPurchased: 1,
    });
};

/** Polls Firestore until the stored item satisfies `predicate`. */
const expectStored = async (name, predicate, message) => {
  await expect
    .poll(
      async () => {
        const stored = await inventoryItem(name);
        return stored ? predicate(stored) : false;
      },
      { message, timeout: 15_000 }
    )
    .toBe(true);
};

test.describe('waste alerts', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/waste-alerts', { waitUntil: 'domcontentloaded' });
    await expect(authedPage.getByRole('heading', { name: 'Waste Alerts' })).toBeVisible();
  });

  test('is reachable from the sidebar', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Wait for the app shell before probing it. `isVisible()` below is a
    // one-shot check with no auto-waiting, and right after domcontentloaded
    // React has not mounted the layout yet — so without this the hamburger
    // reads as absent, the sidebar never opens, and the click below spends the
    // whole timeout on a link parked off-screen.
    await expect(page.locator('.app-footer__version')).toBeVisible();

    // On a phone the sidebar sits off-screen until the hamburger opens it. The
    // hamburger is `d-lg-none`, so on desktop it is display:none and the
    // sidebar is already on screen.
    const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(page.locator('.app-sidebar--open')).toBeVisible();
    }

    await page.getByRole('link', { name: 'Waste Alerts' }).first().click();

    await expect(page).toHaveURL(/\/waste-alerts/);
    await expect(page.locator('.app-footer__version')).toBeVisible();
  });

  test('lists the seeded at-risk food and leaves the rest out', async ({ authedPage: page }) => {
    // Seeded in global-setup: expired yogurt, salmon due tomorrow, rice in 200 days.
    await expect(page.getByTestId('expiring-item').filter({ hasText: 'Old Yogurt' })).toBeVisible();
    await expect(
      page.getByTestId('expiring-item').filter({ hasText: 'Fresh Salmon' })
    ).toBeVisible();
    await expect(page.getByTestId('expiring-item').filter({ hasText: 'Basmati Rice' })).toHaveCount(
      0
    );
  });

  test('counts each urgency band', async ({ authedPage: page }) => {
    await expect(page.getByTestId('summary-expired')).toContainText(/[1-9]/);
    await expect(page.getByTestId('summary-critical')).toContainText(/[1-9]/);
  });

  test('colour-codes the at-risk rows', async ({ authedPage: page }) => {
    await expect(page.locator('.expiration-critical').first()).toBeVisible();
  });

  test('offers to freeze what the freezer would save', async ({ authedPage: page }) => {
    const panel = page.getByTestId('freezer-suggestions');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/if you freeze it/).first()).toBeVisible();
  });
});

test.describe('freezer actions', () => {
  test('freezing an item moves it and pushes the expiry months out', async ({
    authedPage: page,
  }) => {
    // Unique per run: the specs share one seeded account and run in parallel.
    const itemName = `Freeze Me ${Date.now()}`;
    await seedItem(itemName, { daysUntilExpiry: 1 });

    await page.goto('/waste-alerts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Waste Alerts' })).toBeVisible();

    const card = page.getByTestId('freezer-suggestion').filter({ hasText: itemName });
    await expect(card).toHaveCount(1);

    const before = await inventoryItem(itemName);
    await card.getByRole('button', { name: 'Freeze All' }).click();

    // Read it back from Firestore — a write that violates a rule still renders.
    await expectStored(
      itemName,
      (stored) => stored.locationType === 'freezer',
      `waiting for "${itemName}" to be stored in the freezer`
    );
    await expectStored(
      itemName,
      (stored) => stored.expiresAt.toMillis() > before.expiresAt.toMillis(),
      `waiting for "${itemName}" to gain shelf life from being frozen`
    );
  });

  test('freezing half leaves the other half where it was', async ({ authedPage: page }) => {
    const itemName = `Split Me ${Date.now()}`;
    await seedItem(itemName, { daysUntilExpiry: 1, quantity: 4 });

    await page.goto('/waste-alerts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Waste Alerts' })).toBeVisible();

    const card = page.getByTestId('freezer-suggestion').filter({ hasText: itemName });
    await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: 'Freeze Half' }).click();

    const uid = await testUserId();
    await expect
      .poll(
        async () => {
          const snap = await admin.firestore().collection(`users/${uid}/inventory`).get();
          const copies = snap.docs.map((d) => d.data()).filter((d) => d.name === itemName);
          return copies.length === 2 && copies.every((c) => c.quantity === 2);
        },
        { message: `waiting for "${itemName}" to be split in two`, timeout: 15_000 }
      )
      .toBe(true);

    const snap = await admin.firestore().collection(`users/${uid}/inventory`).get();
    const copies = snap.docs.map((d) => d.data()).filter((d) => d.name === itemName);
    expect(copies.map((c) => c.locationType).sort()).toEqual(['freezer', 'fridge']);
  });
});

// ---------------------------------------------------------------------------
// The Phase 6 → Phase 7 seam
//
// "Add to Meal Plan" is the one place waste prevention writes a collection it
// does not own. Nothing proved the document it writes is admitted by the
// mealPlanEntries rules *and* rendered by the meal plan page — and Firestore
// is still in test mode, so a write that violates a rule succeeds today and
// starts failing at step 10.2 with no warning in between.
//
// This drives it through the UI on both sides rather than asserting on
// Firestore alone: a document that lands but never renders is just as broken
// to a cook as one that never lands.
// ---------------------------------------------------------------------------

test.describe('add to meal plan', () => {
  let recipeId;
  let recipeName;
  let itemName;

  test.beforeEach(async () => {
    // Unique per run: the specs share one account and one recipe library, and
    // run in parallel.
    const stamp = Date.now();
    itemName = `Spinach ${stamp}`;
    recipeName = `Creamed Spinach ${stamp}`;

    await seedItem(itemName, { daysUntilExpiry: 1, quantity: 1 });
    recipeId = await seedRecipe({ name: recipeName, ingredients: [itemName] });
  });

  test.afterEach(async () => {
    if (recipeId) await deleteRecipe(recipeId);
  });

  test('schedules the meal, and the meal plan page shows it', async ({ authedPage: page }) => {
    await page.goto('/waste-alerts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Waste Alerts' })).toBeVisible();

    const suggestion = page.getByTestId('recipe-suggestion').filter({ hasText: recipeName });
    await expect(suggestion).toHaveCount(1);
    await suggestion.getByRole('button', { name: 'Add to Meal Plan' }).click();

    // The button's own confirmation is local state and proves nothing.
    await expect(suggestion.getByRole('button', { name: 'On the plan' })).toBeVisible();

    // What actually reached Firestore, through the real security rules.
    await expect
      .poll(async () => (await mealPlanEntry(recipeName))?.source, {
        message: `waiting for "${recipeName}" to reach mealPlanEntries`,
        timeout: 15_000,
      })
      .toBe('waste-prevention');

    const stored = await mealPlanEntry(recipeName);
    expect(stored.date).toBe(toDayKey(new Date()));
    expect(stored.status).toBe('planned');
    expect(stored.servings).toBeGreaterThan(0);
    // What "Mark as Cooked" will decrement — the reason Phase 7 wants it.
    expect(stored.usesIngredients.map((i) => i.normalized)).toContain(itemName.toLowerCase());

    // And now the half that Firestore cannot tell us: does Phase 7 render it?
    await page.goto('/meal-plan', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Meal Plan' })).toBeVisible();

    const today = page.getByTestId(`day-card-${toDayKey(new Date())}`);
    await expect(today).toBeVisible();
    await expect(today.getByText(recipeName)).toBeVisible();
  });
});

test.describe('waste alert settings', () => {
  test('saves SMS preferences in the shape the alert function reads', async ({
    authedPage: page,
  }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Waste Alerts/ }).click();

    const panel = page.getByTestId('sms-alert-settings');
    await expect(panel).toBeVisible();
    // Honest about the fact that no texting service is connected yet.
    await expect(panel.getByText(/Alerts always show up here in the app/)).toBeVisible();

    await panel.getByLabel(/Text me when food is about to go off/).check();
    await panel.getByLabel('Mobile number').fill('5551234567');
    await panel.getByRole('button', { name: /Save Alert Preferences/ }).click();

    await expect(panel.getByText('Alert preferences saved.')).toBeVisible();

    const uid = await testUserId();
    await expect
      .poll(
        async () => {
          const profile = (await admin.firestore().doc(`users/${uid}`).get()).data();
          return profile?.preferences?.smsAlerts;
        },
        { message: 'waiting for the SMS preferences to reach Firestore', timeout: 15_000 }
      )
      .toMatchObject({ enabled: true, phoneNumber: '5551234567' });
  });
});
