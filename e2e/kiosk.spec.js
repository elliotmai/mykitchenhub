// The fridge board.
//
// It sits outside the app layout, so it has none of the chrome the navigation
// spec asserts on — no sidebar, no footer version label. That is the point of
// it, and it is why this lives in its own file rather than in the routes table.

const { test, expect } = require('./fixtures');
const { seedShoppingItem, deleteShoppingItem } = require('./firestore-admin');

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Must match KIOSK_SHOPPING_LIMIT in src/pages/Kiosk.jsx. */
const SHOPPING_LIMIT = 4;

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

  // The board is one screen, and the shopping panel is the smallest of the
  // three — so it is the one a long list would push off the bottom. The
  // "fits the screen without scrolling" spec below cannot catch that on its
  // own: the board is `position: fixed` with `overflow: hidden`, so too much
  // content is clipped rather than made scrollable, and the document stays the
  // size it always was. This is the spec that actually loads the panel up.
  test('caps a long shopping list instead of overflowing its corner', async ({
    authedPage: page,
  }) => {
    const stamp = Date.now();
    const ids = [];
    for (let i = 0; i < SHOPPING_LIMIT + 3; i += 1) {
      ids.push(await seedShoppingItem({ name: `Board Thing ${i} ${stamp}` }));
    }

    try {
      await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });
      const panel = page.getByTestId('kiosk-shopping');
      await expect(panel.getByRole('heading', { name: 'Shopping list' })).toBeVisible();

      await expect(panel.locator('li')).toHaveCount(SHOPPING_LIMIT);
      await expect(panel.getByText(/and \d+ more/)).toBeVisible();

      // And what is shown actually fits the box it is in, rather than being
      // silently cut off at the bottom of the panel.
      const fits = await panel.evaluate((el) => {
        const list = el.querySelector('.kiosk__shopping');
        return {
          list: list.scrollHeight <= list.clientHeight + 1,
          panel: el.scrollHeight <= el.clientHeight + 1,
        };
      });
      expect(fits.list).toBe(true);
      expect(fits.panel).toBe(true);
    } finally {
      await Promise.all(ids.map(deleteShoppingItem));
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
