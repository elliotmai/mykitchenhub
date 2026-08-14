// The What's New popup is the app's release-notes channel. It must appear once
// for a new release and then stay out of the way.

const { test, expect, WHATS_NEW_KEY } = require('./fixtures');
const { WHATS_NEW } = require('../src/config/whatsNew');

// This is the one spec that wants the popup, so it opts out of the suppression
// every other spec relies on.
test.use({ suppressWhatsNew: false });

test.describe("what's new popup", () => {
  test('opens on a first visit and shows the latest entry', async ({ authedPage: page }) => {
    const dialog = page.locator('.whats-new-modal');

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(WHATS_NEW[0].items[0].replace(/^[^\w]+/, '').slice(0, 20));
  });

  test('closes on "Got it" and does not come back', async ({ authedPage: page }) => {
    const dialog = page.locator('.whats-new-modal');
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(dialog).not.toBeVisible();

    await page.reload();
    await expect(dialog).not.toBeVisible();
  });

  test('records the version it showed, so only newer entries reappear', async ({
    authedPage: page,
  }) => {
    await page.getByRole('button', { name: 'Got it' }).click();

    const seen = await page.evaluate((key) => window.localStorage.getItem(key), WHATS_NEW_KEY);

    expect(seen).toBe(WHATS_NEW[0].version);
  });
});
