// Roadmap 9.1 — the app on a phone.
//
// The other specs prove features work. This one proves they are usable with a
// thumb: nothing tapped is smaller than a fingertip, nothing scrolls sideways,
// and getting between pages does not take a detour through a drawer.
//
// It is scoped to the mobile project (see playwright.config.js): running these
// checks at 1280px would assert nothing, because every violation they look for
// only exists when the viewport is narrow.

const { test, expect, chooseCSV, CSV_HEADER } = require('./fixtures');

/**
 * Apple's HIG and Android's Material both settle on ~44px as the smallest
 * comfortable tap target. Anything under it is a mis-tap waiting to happen.
 */
const MIN_TOUCH_TARGET = 44;

/** Every page a cook can reach from the nav. */
const PAGES = [
  '/dashboard',
  '/inventory',
  '/recipes',
  '/meal-plan',
  '/hellofresh',
  '/waste-alerts',
  '/analytics',
  '/settings',
];

/**
 * Measures every visible interactive element and returns the ones too small to
 * tap reliably.
 *
 * Elements are matched on the accessible name so a failure says *which* control
 * is wrong, and measured with getBoundingClientRect because it is the rendered
 * box a thumb has to hit — offsetWidth ignores transforms and fractional
 * layout.
 */
const undersizedTargets = (page, min) =>
  page.evaluate((minSize) => {
    const selector = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button]';
    const problems = [];

    document.querySelectorAll(selector).forEach((el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
        return;

      const rect = el.getBoundingClientRect();
      // Zero-sized means it is not laid out — collapsed menus, offscreen
      // drawers. A thumb cannot hit those either way.
      if (rect.width === 0 || rect.height === 0) return;

      // Rounded before comparing: a `min-height: 44px` control measures
      // 43.99px at some device pixel ratios, and chasing that is chasing
      // rounding rather than anything a thumb can tell apart.
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);

      if (width < minSize || height < minSize) {
        problems.push({
          label: (
            el.getAttribute('aria-label') ||
            el.textContent?.trim().slice(0, 40) ||
            el.className ||
            el.tagName
          ).toString(),
          tag: el.tagName.toLowerCase(),
          width,
          height,
        });
      }
    });

    return problems;
  }, min);

/** True when the document is wider than the window — the sideways-scroll bug. */
const overflowsHorizontally = (page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    // +1 absorbs sub-pixel rounding, which is not something a thumb notices.
    return doc.scrollWidth > doc.clientWidth + 1;
  });

/** The element sticking out past the right edge, for a failure worth reading. */
const widestOffender = (page) =>
  page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    let worst = null;

    /**
     * True when something above `el` scrolls horizontally.
     *
     * A wide table inside `overflow-x: auto` is the correct answer to a narrow
     * screen, not a bug — but it still reports a bounding rect past the edge,
     * because the rect describes the element, not the window it is seen
     * through. Without this the analytics table failed a check it passes.
     */
    const insideAScroller = (el) => {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true;
      }
      return false;
    };

    document.querySelectorAll('body *').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      if (rect.right <= limit + 1) return;
      if (insideAScroller(el)) return;

      if (!worst || rect.right > worst.right) {
        worst = {
          right: Math.round(rect.right),
          tag: el.tagName.toLowerCase(),
          className: String(el.className).slice(0, 60),
        };
      }
    });

    return worst;
  });

test.describe('on a phone', () => {
  for (const path of PAGES) {
    test(`${path} fits the screen without scrolling sideways`, async ({ authedPage: page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.app-footer__version')).toBeVisible();

      // Asserted on the offending element rather than on a boolean with a
      // message: the element *is* the evidence, so a failure names what stuck
      // out instead of just saying "true is not false". The scrollWidth check
      // stays as a backstop for overflow no single element accounts for.
      expect(await widestOffender(page)).toBeNull();
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test(`${path} has no tap target smaller than ${MIN_TOUCH_TARGET}px`, async ({
      authedPage: page,
    }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.app-footer__version')).toBeVisible();

      // The array is the message: a failure prints every control that is too
      // small, with its size and accessible name.
      expect(await undersizedTargets(page, MIN_TOUCH_TARGET)).toEqual([]);
    });
  }
});

test.describe('mobile navigation', () => {
  test('reaches the main pages in one tap, without opening the drawer', async ({
    authedPage: page,
  }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    const bar = page.getByRole('navigation', { name: 'Primary' });
    await expect(bar).toBeVisible();

    // One tap, straight to the page — not "open drawer, then tap".
    await bar.getByRole('link', { name: 'Inventory' }).click();
    await expect(page).toHaveURL(/\/inventory/);

    await bar.getByRole('link', { name: 'Recipes' }).click();
    await expect(page).toHaveURL(/\/recipes/);
  });

  test('marks the page you are on, so the bar says where you are', async ({ authedPage: page }) => {
    await page.goto('/recipes', { waitUntil: 'domcontentloaded' });

    const bar = page.getByRole('navigation', { name: 'Primary' });
    await expect(bar.getByRole('link', { name: 'Recipes' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(bar.getByRole('link', { name: 'Inventory' })).not.toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  test('keeps the drawer for everything the bar has no room for', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Toggle sidebar' }).click();

    const drawer = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(drawer.getByRole('link', { name: 'HelloFresh' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Analytics' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  test('does not cover the footer it sits above', async ({ authedPage: page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Scrolled as far down as it goes, the version label must still be readable
    // rather than sitting underneath the bar.
    //
    // Two things this needs to get right, both of which produced a confident
    // wrong answer first:
    //
    //  - Scroll instantly. The app sets `html { scroll-behavior: smooth }`,
    //    which applies to scripted scrolls too, so a plain scrollTo animates
    //    and whatever measures next reads a position still being travelled
    //    through.
    //  - Scroll again on every attempt. The footer renders with the layout, so
    //    it is visible long before the dashboard's data is, and each thing that
    //    arrives makes the page taller — a scroll-once-then-measure reads a
    //    page that has grown underneath it and reports an overlap that is not
    //    there.
    const version = page.locator('.app-footer__version');
    await expect(version).toBeVisible();

    await expect
      .poll(async () => {
        await page.evaluate(() =>
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
        );

        const [versionBox, barBox] = await Promise.all([
          version.boundingBox(),
          page.getByRole('navigation', { name: 'Primary' }).boundingBox(),
        ]);

        // How far the footer's bottom edge sits below the bar's top edge.
        // Zero or less means the bar is not covering it.
        return Math.round(versionBox.y + versionBox.height - barBox.y);
      })
      .toBeLessThanOrEqual(0);
  });
});

// Lives here rather than in csv-import.spec.js because it is a layout check,
// and only the mobile project runs at a phone viewport. It sat in that spec
// behind `test.skip(!mobile)` — and once 9.1 narrowed the mobile project to
// the specs where width changes the answer, csv-import stopped running on a
// phone at all, so the skip became permanent and the check never ran again.
//
// The page-level sweep above cannot cover this: the thing that overflows is a
// modal holding 40 preview rows, which only exists once a file is chosen.
test.describe('csv import on a phone', () => {
  test('keeps the preview inside the screen', async ({ authedPage: page }) => {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });

    const rows = Array.from(
      { length: 40 },
      (_, i) => `Wide Item Name Number ${i},${i + 1},ea,Pantry`
    );
    const modal = await chooseCSV(page, [CSV_HEADER, ...rows].join('\n'), 'phone.csv');

    await expect(modal.getByText('40 ready to import')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
