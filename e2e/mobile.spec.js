// Roadmap 9.1 — the app on a phone.
//
// The other specs prove features work. This one proves they are usable with a
// thumb: nothing tapped is smaller than a fingertip, nothing scrolls sideways,
// and getting between pages does not take a detour through a drawer.
//
// It is scoped to the mobile project (see playwright.config.js): running these
// checks at 1280px would assert nothing, because every violation they look for
// only exists when the viewport is narrow.

const { test, expect } = require('./fixtures');

const HEADER = 'name,quantity,unit,location';

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

// ---------------------------------------------------------------------------
// Does the check work?
//
// `undersizedTargets` returning `[]` is only good news if it is capable of
// returning anything else. A selector typo, a units mistake, a guard clause
// that skips every element — each one turns the eight assertions below into
// eight tests that pass on any page at all, including a broken one, and
// nothing else in the suite would notice.
//
// So the detector is pointed at a control that has been deliberately shrunk,
// and required to complain. The shrinking is done with a stylesheet injected
// into this one page, which changes nothing for any other spec.
// ---------------------------------------------------------------------------
test.describe('the tap-target check itself', () => {
  test('notices a control that shrinks below the floor', async ({ authedPage: page }) => {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-footer__version')).toBeVisible();

    // Clean to begin with — otherwise "it complained" proves nothing.
    expect(await undersizedTargets(page, MIN_TOUCH_TARGET)).toEqual([]);

    await page.addStyleTag({
      content: `
        [data-testid="tap-target-canary"] {
          min-width: 12px !important;
          min-height: 12px !important;
          width: 12px !important;
          height: 12px !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
      `,
    });
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.testid = 'tap-target-canary';
      button.setAttribute('aria-label', 'Tap target canary');
      document.body.appendChild(button);
    });

    const problems = await undersizedTargets(page, MIN_TOUCH_TARGET);

    // It found it, it found only it, and it reported the size it measured —
    // which is what makes a real failure readable.
    expect(problems).toEqual([
      { label: 'Tap target canary', tag: 'button', width: 12, height: 12 },
    ]);
  });

  test('measures the rendered box, not the requested one', async ({ authedPage: page }) => {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-footer__version')).toBeVisible();

    // A control that asks for 44px and is then scaled down is 22px to a thumb.
    // getBoundingClientRect is what sees that; offsetHeight would not.
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Scaled canary');
      button.style.cssText =
        'width:44px;height:44px;min-width:44px;min-height:44px;transform:scale(0.5);';
      document.body.appendChild(button);
    });

    expect(await undersizedTargets(page, MIN_TOUCH_TARGET)).toEqual([
      { label: 'Scaled canary', tag: 'button', width: 22, height: 22 },
    ]);
  });
});

/**
 * Opens the CSV importer and hands it a file, returning the open modal.
 *
 * Defaults to 40 wide rows, which is what makes the preview table the widest
 * thing on a 412px screen — a narrower file passes a layout check that a real
 * shopping list would not.
 */
const openCSVPreview = async (page, text, name = 'phone.csv') => {
  const csv =
    text ??
    [
      HEADER,
      ...Array.from({ length: 40 }, (_, i) => `Wide Item Name Number ${i},${i + 1},ea,Pantry`),
    ].join('\n');

  const modal = page.locator('.modal.show');

  // Same retried click as csv-import.spec.js: under load the button is
  // occasionally clicked before React has wired it up, and the failure then
  // reads as a layout bug rather than a dropped click.
  await expect(async () => {
    if (!(await modal.isVisible())) {
      await page.getByRole('button', { name: /import csv/i }).click();
    }
    await expect(modal).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  await modal.getByLabel('Choose a CSV file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });

  return modal;
};

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

  // -------------------------------------------------------------------------
  // Where you are, on routes the bar has no button for
  //
  // Four tabs cover eight pages. The four that are not on the bar must leave
  // it showing nothing rather than leaving the previous page's tab lit, which
  // is a bar that confidently says the wrong thing.
  // -------------------------------------------------------------------------
  test('marks exactly one tab, or none at all, on every route', async ({ authedPage: page }) => {
    const expected = {
      '/dashboard': 'Home',
      '/inventory': 'Inventory',
      '/recipes': 'Recipes',
      '/waste-alerts': 'Alerts',
      // On the bar's own terms these are "somewhere else" — reached through
      // More, and correctly leaving every tab unlit.
      '/meal-plan': null,
      '/hellofresh': null,
      '/analytics': null,
      '/settings': null,
    };

    const bar = page.getByRole('navigation', { name: 'Primary' });
    const actual = {};

    for (const path of Object.keys(expected)) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.app-footer__version')).toBeVisible();

      // The label element, not the link's textContent: the Alerts tab carries
      // a count badge inside the link, so reading the whole thing says
      // "2Alerts" on a kitchen with food going off.
      const marked = await bar
        .locator('[aria-current="page"] .mobile-nav__label')
        .evaluateAll((labels) => labels.map((l) => l.textContent.trim()));

      // One entry per route rather than an assertion per route: a failure then
      // prints the whole bar-vs-URL table, which is what you need to see.
      actual[path] = marked.length === 0 ? null : marked.length === 1 ? marked[0] : marked;
    }

    expect(actual).toEqual(expected);
  });

  test('keeps the section marked while you are reading a recipe', async ({ authedPage: page }) => {
    // The detail view is a query parameter on /recipes rather than its own
    // path, and opening one is still "in Recipes" — the tab must not go dark
    // just because the URL grew a `?recipe=`.
    await page.goto('/recipes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

    await page
      .locator('.recipe-card')
      .filter({ hasText: 'Seeded Sheet Pan Salmon' })
      .getByRole('button', { name: 'View' })
      .click();
    await expect(page).toHaveURL(/\?recipe=/);

    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Recipes' })
    ).toHaveAttribute('aria-current', 'page');
  });

  // -------------------------------------------------------------------------
  // The phone changing shape underneath it
  // -------------------------------------------------------------------------
  test('survives being turned on its side', async ({ authedPage: page }) => {
    const portrait = page.viewportSize();
    const bar = page.getByRole('navigation', { name: 'Primary' });
    await expect(bar).toBeVisible();

    await page.setViewportSize({ width: portrait.height, height: portrait.width });
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    // Landscape on a phone is still narrower than the sidebar breakpoint, so
    // the bar is still the navigation — and it must not have grown a sideways
    // scroll or shrunk its tabs below the floor on the way round.
    await expect(bar).toBeVisible();
    expect(await overflowsHorizontally(page)).toBe(false);
    expect(await undersizedTargets(page, MIN_TOUCH_TARGET)).toEqual([]);

    const box = await bar.boundingBox();
    expect(Math.round(box.width)).toBe(portrait.height);
  });

  test('stays out of the way when the software keyboard takes half the screen', async ({
    authedPage: page,
  }) => {
    // A keyboard opening shortens the viewport rather than the document. The
    // bar is fixed to the bottom of that viewport, so this is where it can end
    // up sitting on the field being typed into.
    const { width, height } = page.viewportSize();

    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: /add item/i })
      .first()
      .click();

    const modal = page.locator('.modal.show');
    await expect(modal).toBeVisible();

    // Roughly what an Android keyboard leaves behind.
    await page.setViewportSize({ width, height: Math.round(height * 0.45) });

    const field = modal.getByPlaceholder(/Chicken Breast/);
    await field.scrollIntoViewIfNeeded();
    await field.click();
    await field.fill('Keyboard Test');

    // The field the cook is typing into must be the thing at that point on the
    // screen, not the navigation bar drawn over it.
    const box = await field.boundingBox();
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('.mobile-nav') ? 'the bar' : (el?.tagName ?? 'nothing');
      },
      [box.x + box.width / 2, box.y + box.height / 2]
    );

    expect(hit).toBe('INPUT');
    await expect(field).toHaveValue('Keyboard Test');
  });

  // -------------------------------------------------------------------------
  // The other things pinned to the bottom of the screen
  // -------------------------------------------------------------------------
  test('is not buried by the offline banner when the signal drops', async ({
    authedPage: page,
  }) => {
    // Both are fixed to the bottom edge and the banner is the one on top
    // (z-index 1050 against the bar's 1030), so at bottom:0 it covered all
    // five tabs — and it only appears offline, which is exactly when a cook is
    // stood in the kitchen relying on the precached shell.
    const bar = page.getByRole('navigation', { name: 'Primary' });
    await expect(bar).toBeVisible();

    await page.context().setOffline(true);
    try {
      const banner = page.getByText(/You're offline/);
      await expect(banner).toBeVisible();

      const [barBox, bannerBox] = await Promise.all([bar.boundingBox(), banner.boundingBox()]);

      // The banner sits entirely above the bar's top edge.
      expect(Math.round(bannerBox.y + bannerBox.height)).toBeLessThanOrEqual(
        Math.round(barBox.y) + 1
      );

      // And every tab is still the thing under your thumb, not the banner.
      const labels = ['Home', 'Inventory', 'Recipes', 'Alerts'];
      const underThumb = {};

      for (const label of labels) {
        const box = await bar.getByRole('link', { name: label }).boundingBox();
        underThumb[label] = await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el?.closest('.mobile-nav__link') ? 'the bar' : (el?.className ?? 'nothing');
          },
          [box.x + box.width / 2, box.y + box.height / 2]
        );
      }

      expect(underThumb).toEqual(Object.fromEntries(labels.map((l) => [l, 'the bar'])));
    } finally {
      await page.context().setOffline(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Controls the page walk never sees
//
// `undersizedTargets` measures what is on screen when it runs, so a control
// that only exists inside a modal, or only after a file is chosen, or only in
// an error state, is not covered by any of the per-page checks above however
// many pages they visit.
// ---------------------------------------------------------------------------
test.describe('tap targets that only exist once you open something', () => {
  test('inside the add-item modal', async ({ authedPage: page }) => {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    await page
      .getByRole('button', { name: /add item/i })
      .first()
      .click();
    await expect(page.locator('.modal.show')).toBeVisible();

    expect(await undersizedTargets(page, MIN_TOUCH_TARGET)).toEqual([]);
  });

  test('and the modal keeps its submit button clear of the bar', async ({ authedPage: page }) => {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: /add item/i })
      .first()
      .click();

    const modal = page.locator('.modal.show');
    await expect(modal).toBeVisible();

    const submit = modal.getByRole('button', { name: 'Add Item' });
    await submit.scrollIntoViewIfNeeded();
    const box = await submit.boundingBox();

    // Whatever is at the middle of the submit button must be the submit
    // button. A bar drawn over it is a form that cannot be completed.
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('button')?.textContent?.trim() ?? el?.tagName;
      },
      [box.x + box.width / 2, box.y + box.height / 2]
    );

    expect(hit).toBe('Add Item');
  });

  test('keeps the preview inside the screen on a phone', async ({ authedPage: page }) => {
    // Relocated from csv-import.spec.js, which is desktop-only: this check
    // skipped itself off the desktop project and the mobile project does not
    // load that file, so it ran nowhere at all. Layout checks belong here,
    // which is the file the mobile project is pointed at.
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    const modal = await openCSVPreview(page);
    await expect(modal.getByText('40 ready to import')).toBeVisible();

    expect(await widestOffender(page)).toBeNull();
    expect(await overflowsHorizontally(page)).toBe(false);
  });

  test('in the CSV import preview, rows and all', async ({ authedPage: page }) => {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    const modal = await openCSVPreview(page);
    await expect(modal.getByText('40 ready to import')).toBeVisible();

    expect(await undersizedTargets(page, MIN_TOUCH_TARGET)).toEqual([]);
  });

  test('in the "we had to skip these" table an import falls back to', async ({
    authedPage: page,
  }) => {
    // The error state is rendered by different code from the happy path and is
    // the one a cook meets on their worst spreadsheet, so it gets measured too.
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    const rows = Array.from({ length: 12 }, (_, i) => `,${i + 1},ea,Nowhere At All`);
    const modal = await openCSVPreview(page, [HEADER, ...rows].join('\n'), 'broken.csv');

    await expect(modal.getByRole('table', { name: 'Rows we had to skip' })).toBeVisible();

    expect(await undersizedTargets(page, MIN_TOUCH_TARGET)).toEqual([]);
    expect(await widestOffender(page)).toBeNull();
  });
});
