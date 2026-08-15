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

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(dialog).not.toBeVisible();
  });

  test('keeps "Got it" tappable, whatever else is pinned to the bottom', async ({
    authedPage: page,
  }) => {
    // The popup opens over every page and swallows clicks, so if anything were
    // drawn on top of its dismiss button the app would be stuck until the entry
    // aged out. On a phone the thing that could do that is the bottom tab bar,
    // pinned to the same edge; on desktop it would be any other overlay.
    //
    // Deliberately not skipped on desktop. A test.skip that leaves a spec
    // running in no project at all is how the CSV preview's phone check went
    // unnoticed for a whole phase — and the assertion is worth making at both
    // widths anyway.
    const gotIt = page.getByRole('button', { name: 'Got it' });
    await expect(gotIt).toBeVisible();

    const box = await gotIt.boundingBox();
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('.mobile-nav') ? 'the bar' : (el?.textContent?.trim() ?? 'nothing');
      },
      [box.x + box.width / 2, box.y + box.height / 2]
    );

    expect(hit).toBe('Got it');

    // And it really does dismiss, rather than merely being on top.
    await gotIt.click();
    await expect(page.locator('.whats-new-modal')).not.toBeVisible();
  });

  test('records the version it showed, so only newer entries reappear', async ({
    authedPage: page,
  }) => {
    await page.getByRole('button', { name: 'Got it' }).click();

    const seen = await page.evaluate((key) => window.localStorage.getItem(key), WHATS_NEW_KEY);

    expect(seen).toBe(WHATS_NEW[0].version);
  });
});
