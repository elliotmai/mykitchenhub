// The fridge board.
//
// It sits outside the app layout, so it has none of the chrome the navigation
// spec asserts on — no sidebar, no footer version label. That is the point of
// it, and it is why this lives in its own file rather than in the routes table.

const { test, expect } = require('./fixtures');
const {
  seedShoppingItem,
  deleteShoppingItem,
  shoppingItem,
  shoppingItems,
  seedMealPlanEntry,
  deleteMealPlanEntry,
  seedRecipe,
  deleteRecipe,
} = require('./firestore-admin');

/** Today as the board keys it — local date, not UTC, same as buildWeekDays. */
const todayKey = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Must match KIOSK_VISIBLE_ROWS in src/pages/Kiosk.jsx. */
const VISIBLE_ROWS = 5;

test.describe('fridge board', () => {
  test('shows the whole week, Monday to Sunday, with the date on each day', async ({
    authedPage: page,
  }) => {
    await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();

    const names = page.locator('.kiosk__day-name');
    await expect(names).toHaveCount(7);
    expect(await names.allTextContents()).toEqual(DAY_NAMES);

    // Every day carries a date, and they are real days of a month.
    const numbers = await page.locator('.kiosk__day-number').allTextContents();
    expect(numbers).toHaveLength(7);
    numbers.forEach((n) => {
      expect(Number(n)).toBeGreaterThanOrEqual(1);
      expect(Number(n)).toBeLessThanOrEqual(31);
    });
  });

  test('marks exactly one day as today', async ({ authedPage: page }) => {
    await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();

    await expect(page.locator('.kiosk__day--today')).toHaveCount(1);
  });

  test('leads with the week and follows with what needs eating', async ({ authedPage: page }) => {
    await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();

    const panels = page.locator('.kiosk__panel');
    await expect(panels).toHaveCount(3);
    await expect(panels.nth(0)).toHaveClass(/kiosk__panel--week/);
    await expect(panels.nth(1)).toHaveClass(/kiosk__panel--eat/);
    await expect(panels.nth(2)).toHaveClass(/kiosk__panel--shopping/);
  });

  test('shows what needs buying, typed items and the week’s own alike', async ({
    authedPage: page,
  }) => {
    const stamp = Date.now();
    const typed = `Board Batteries ${stamp}`;
    const id = await seedShoppingItem({ name: typed });

    try {
      await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });

      const panel = page.getByTestId('kiosk-shopping');
      await expect(panel.getByRole('heading', { name: 'Shopping list' })).toBeVisible();
      await expect(panel.getByText(typed)).toBeVisible();
      await expect(panel.getByText('Coming soon')).toHaveCount(0);
    } finally {
      await deleteShoppingItem(id);
    }
  });

  test('does not put something already ticked off back on the fridge', async ({
    authedPage: page,
  }) => {
    const stamp = Date.now();
    const bought = `Board Bought ${stamp}`;
    const id = await seedShoppingItem({ name: bought, status: 'bought' });

    try {
      await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();

      await expect(page.getByTestId('kiosk-shopping').getByText(bought)).toHaveCount(0);
    } finally {
      await deleteShoppingItem(id);
    }
  });

  // The panel scrolls now rather than capping, which moves where this can go
  // wrong. The failure to catch is no longer "the list is too long for the
  // corner" but "the list spills its panel instead of scrolling inside it" —
  // and that one is invisible from the document's own dimensions, because the
  // board is `position: fixed` with `overflow: hidden` and clips silently.
  test('scrolls a long shopping list inside its panel rather than spilling it', async ({
    authedPage: page,
  }) => {
    const stamp = Date.now();
    const ids = [];
    for (let i = 0; i < VISIBLE_ROWS + 4; i += 1) {
      ids.push(await seedShoppingItem({ name: `Board Thing ${i} ${stamp}` }));
    }

    try {
      await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
      const panel = page.getByTestId('kiosk-shopping');
      await expect(panel.getByRole('heading', { name: 'Shopping list' })).toBeVisible();

      // Nothing is cut off: every seeded item is on the board.
      await expect(panel.locator('li')).toHaveCount(VISIBLE_ROWS + 4);
      await expect(panel.getByText(/scroll for \d+ more/)).toBeVisible();

      const list = page.getByTestId('kiosk-shopping-list');
      const geometry = await list.evaluate((el) => ({
        scrolls: el.scrollHeight > el.clientHeight + 1,
        panelContained:
          el.closest('.kiosk__panel').scrollHeight <= el.closest('.kiosk__panel').clientHeight + 1,
      }));
      expect(geometry.scrolls).toBe(true);
      // The overflow belongs to the list. If the panel itself has grown, the
      // board is clipping content that no gesture can reach.
      expect(geometry.panelContained).toBe(true);

      // And the gesture actually works: the last item is reachable.
      const last = panel.getByText(`Board Thing ${VISIBLE_ROWS + 3} ${stamp}`);
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
    } finally {
      await Promise.all(ids.map(deleteShoppingItem));
    }
  });

  // The two right-column panels are set to one scale on purpose. It is the
  // kind of thing that drifts the moment either panel is touched on its own,
  // and it is immediately visible on a wall display: two lists of short lines,
  // one above the other, at different sizes.
  test('sets the shopping list and the expiring list to the same scale', async ({
    authedPage: page,
  }) => {
    const name = `Board Scale ${Date.now()}`;
    const id = await seedShoppingItem({ name });

    try {
      await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });

      const rowSize = (testId) =>
        page
          .getByTestId(testId)
          .locator('li')
          .first()
          .evaluate((el) => {
            const style = getComputedStyle(el);
            const when = el.querySelector('.kiosk__item-when');
            return {
              font: style.fontSize,
              padding: style.paddingTop,
              amount: when ? getComputedStyle(when).fontSize : null,
            };
          });

      const headingSize = (panelTestId) =>
        page
          .getByTestId(panelTestId)
          .locator('.kiosk__panel-title')
          .evaluate((el) => getComputedStyle(el).fontSize);

      await expect(page.getByTestId('kiosk-shopping').locator('li').first()).toBeVisible();
      const shopping = await rowSize('kiosk-shopping-list');
      const eating = await rowSize('kiosk-eat-list');

      expect(shopping.font).toBe(eating.font);
      expect(shopping.padding).toBe(eating.padding);
      expect(shopping.amount).toBe(eating.amount);
      expect(await headingSize('kiosk-shopping')).toBe(await headingSize('kiosk-eat-panel'));

      // The week deliberately stays larger — it is what you walked over to
      // read. Asserted so "make them all match" cannot quietly flatten it.
      const week = await page
        .getByTestId('kiosk-week-panel')
        .locator('.kiosk__panel-title')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(week).toBeGreaterThan(parseFloat(shopping.font));
    } finally {
      await deleteShoppingItem(id);
    }
  });

  test('scrolls the expiring list inside its own panel too', async ({ authedPage: page }) => {
    await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Eat these first' })).toBeVisible();

    // The seeded kitchen may or may not have enough going off to overflow, so
    // this asserts the mechanism rather than the overflow: whatever is in it,
    // the list owns its own scrolling and the panel does not grow.
    const list = page.getByTestId('kiosk-eat-list');
    if (await list.count()) {
      const contained = await list.evaluate(
        (el) =>
          el.closest('.kiosk__panel').scrollHeight <= el.closest('.kiosk__panel').clientHeight + 1
      );
      expect(contained).toBe(true);
      await expect(list).toHaveCSS('overflow-y', 'auto');
    }
  });

  test('puts an item on the list from the board itself', async ({ authedPage: page }) => {
    const name = `Fridge Note ${Date.now()}`;

    try {
      await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Add an item to the shopping list').fill(name);
      await page.getByRole('button', { name: 'Add to the shopping list' }).click();

      await expect(page.getByTestId('kiosk-shopping').getByText(name)).toBeVisible();
      // Read back through the rules rather than trusting the optimistic render.
      await expect.poll(async () => Boolean(await shoppingItem(name))).toBe(true);
    } finally {
      const stored = await shoppingItem(name);
      if (stored) await deleteShoppingItem(stored.id);
    }
  });

  // The board reads the list and adds to it. It does not tick items off and it
  // does not delete them — those are shop-aisle actions, done on the phone in
  // your hand, and a destructive control on a wall display is one a passing
  // elbow can press. This asserts the absence, and that the row survives a
  // deliberate tap on it.
  test('offers no way to tick off or delete a row', async ({ authedPage: page }) => {
    const name = `Fridge Read Only ${Date.now()}`;
    const id = await seedShoppingItem({ name });

    try {
      await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
      const panel = page.getByTestId('kiosk-shopping');
      await expect(panel.getByText(name)).toBeVisible();

      const row = panel.getByRole('listitem').filter({ hasText: name });
      await expect(row.getByRole('checkbox')).toHaveCount(0);
      await expect(row.getByRole('button')).toHaveCount(0);

      await row.click();
      await expect(panel.getByText(name)).toBeVisible();
      expect((await shoppingItems()).find((i) => i.id === id)?.status).toBe('pending');
    } finally {
      await deleteShoppingItem(id);
    }
  });

  test('opens the recipe behind a meal on the week', async ({ authedPage: page }) => {
    const stamp = Date.now();
    const recipeName = `Board Recipe ${stamp}`;
    const recipeId = await seedRecipe({ name: recipeName });
    const entryId = await seedMealPlanEntry({ date: todayKey(), recipeName, recipeId });

    try {
      await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: recipeName }).click();

      await page.waitForURL(new RegExp(`recipe=${recipeId}`));
      await expect(page.getByRole('heading', { name: recipeName })).toBeVisible();
    } finally {
      await deleteMealPlanEntry(entryId);
      await deleteRecipe(recipeId);
    }
  });

  test('wears none of the app chrome, and offers a way back into it', async ({
    authedPage: page,
  }) => {
    await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();

    // The layout's footer version label is the marker the navigation spec uses
    // for "inside the app shell". The board is deliberately outside it.
    await expect(page.locator('.app-footer__version')).toHaveCount(0);

    await page.getByRole('link', { name: 'Open the full app' }).click();
    await page.waitForURL(/\/dashboard/);
  });

  // A board that has to scroll is a board nobody reads from across the room.
  test('fits the screen without scrolling', async ({ authedPage: page }) => {
    await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();

    const overflows = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        sideways: doc.scrollWidth > doc.clientWidth + 1,
        down: doc.scrollHeight > doc.clientHeight + 1,
      };
    });
    expect(overflows.sideways).toBe(false);
    expect(overflows.down).toBe(false);
  });
});
