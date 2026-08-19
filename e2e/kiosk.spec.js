// The fridge board.
//
// It sits outside the app layout, so it has none of the chrome the navigation
// spec asserts on — no sidebar, no footer version label. That is the point of
// it, and it is why this lives in its own file rather than in the routes table.

const { test, expect } = require('./fixtures');

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

  // The grocery list is being built separately. The board holds its corner so
  // the proportions do not move when it lands.
  test('holds a corner for the shopping list', async ({ authedPage: page }) => {
    await page.goto('/kiosk', { waitUntil: 'domcontentloaded' });

    const panel = page.getByTestId('kiosk-shopping');
    await expect(panel.getByRole('heading', { name: 'Shopping list' })).toBeVisible();
    await expect(panel.getByText('Coming soon')).toBeVisible();
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
