// e2e/auth.setup.js
// Signs in once and saves the browser state for every other spec to reuse.
//
// Signing in through the real form costs ~15s (Firebase auth emulator round
// trip plus the app's redirect). Paying that per test made the suite slow
// enough to time out under CI's reduced parallelism. This runs once as a
// `setup` project that the other projects depend on.
//
// `indexedDB: true` is essential: the Firebase JS SDK persists its session in
// IndexedDB, not localStorage, so state saved without it restores a signed-out
// browser.

const { test: setup, expect } = require('@playwright/test');
const { login } = require('./fixtures');
const { STORAGE_STATE } = require('./storage-state');

setup('authenticate', async ({ page, context }) => {
  await login(page);

  // Confirm the app really considers us signed in before capturing state.
  await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible();

  await context.storageState({ path: STORAGE_STATE, indexedDB: true });
});
