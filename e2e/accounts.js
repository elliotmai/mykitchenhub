// e2e/accounts.js
// One seeded account per Playwright worker — roadmap 9.2.
//
// Every spec used to share a single account, and every spec that writes left
// its writes behind. Two things followed from that. The suite got slower as it
// ran, because each page load read a kitchen that had been growing since the
// first spec. And specs could not trust what they saw: one that asserted an
// exact count passed until a later section added a fixture that changed it,
// and the failure surfaced in a spec that had nothing to do with the change.
//
// Playwright sets TEST_PARALLEL_INDEX in every worker process, which is how
// this file works out which account "we" are without any spec having to say so.
// That is deliberate: e2e/firestore-admin.js resolves the same account the same
// way, so all fourteen specs got isolation without a line of change.

/** Shared by every account — the emulator does not care about strength. */
const PASSWORD = 'TestPassword123!';

/**
 * The name shown in the app. The same for every account on purpose: the
 * dashboard spec asserts the greeting names the cook, and it should not have to
 * know which worker it landed on.
 */
const DISPLAY_NAME = 'E2E Cook';

/**
 * The account e2e/auth.spec.js signs in and out of.
 *
 * Separate from the worker accounts because that spec deliberately fails a
 * login, and repeated failures earn an `auth/too-many-requests` lockout. Wearing
 * that on an account another spec needs would be a confusing way to fail.
 */
const TEST_USER = {
  email: 'e2e-cook@example.com',
  password: PASSWORD,
  displayName: DISPLAY_NAME,
};

/**
 * A signed-up cook who has not put anything in their kitchen yet.
 *
 * Gets a profile and the default storage locations — what the sign-up function
 * actually creates — and nothing else. Roadmap 9.3 asks for empty states, and
 * an empty state is not testable on an account the other specs keep filling.
 *
 * Shared by every worker on purpose: the specs that use it only read.
 */
const EMPTY_USER = {
  email: 'e2e-newcomer@example.com',
  password: PASSWORD,
  displayName: 'New Cook',
};

/** The account belonging to worker `index`. */
const accountForWorker = (index) => ({
  email: `e2e-cook+w${index}@example.com`,
  password: PASSWORD,
  displayName: DISPLAY_NAME,
});

/**
 * The account for the worker this code is running in.
 *
 * Falls back to worker 0 outside a worker — globalSetup and one-off scripts —
 * which is harmless because those only ever seed or read.
 */
const currentAccount = () => accountForWorker(Number(process.env.TEST_PARALLEL_INDEX ?? 0));

module.exports = {
  PASSWORD,
  DISPLAY_NAME,
  TEST_USER,
  EMPTY_USER,
  accountForWorker,
  currentAccount,
};
