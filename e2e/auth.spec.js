// Authentication and route protection, against a real build + emulators.

const { test, expect, login, TEST_USER } = require('./fixtures');

test.describe('authentication', () => {
  test('sends a signed-out visitor to the login page', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('signs in with valid credentials and lands on the dashboard', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible();
  });

  test('rejects a wrong password with a readable message, not an error code', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
    await page.getByPlaceholder('••••••••').first().fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    const alert = page.locator('.alert, [role="alert"]').first();
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText('auth/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('keeps the session across a reload', async ({ page }) => {
    await login(page);

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible();
  });

  test('redirects an already signed-in user away from the login page', async ({ page }) => {
    await login(page);

    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
