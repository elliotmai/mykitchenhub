# Testing & CI

Four suites guard this app, each covering something the others can't. All four
run on every pull request and every push to `main` (`.github/workflows/ci.yml`).

| Suite | Command | What it proves |
| --- | --- | --- |
| Frontend unit/component | `npm run test:ci` | Hooks and components behave, in isolation, with Firebase mocked |
| Cloud Functions | `npm run test:functions` | Backend logic and reference data are correct |
| Firestore rules | `npm run test:rules` | The deployed database will actually allow/deny what we think |
| End-to-end | `npm run test:e2e` | A real production build works against real emulators |

`npm run validate` runs lint + format + unit tests + build — the fast local
pre-push check.

---

## Frontend unit and component tests

Jest + React Testing Library, via `craco test` (CRA's runner).

```bash
npm test                 # watch mode
npm run test:ci          # single run with coverage, as CI runs it
npm run test:tz          # the same suite from a non-UTC zone
npm test -- ItemCard     # one file
```

### Dates: run it in another timezone

CI's clock is UTC, where local time and UTC are the same thing — so anything
that confuses the two passes. `npm run test:tz` runs the whole suite from
`America/New_York`, and the `unit-tz` CI job does the same on every PR. It has
already caught a month of spending bucketed into the wrong month and a shelf
life asserted as an exact millisecond count across a daylight-saving change.

Two rules keep it green:

- **A bare `YYYY-MM-DD` is a local calendar day, never an instant.** Parse one
  with `toDate` from `src/utils/timestamps.js`, in fixtures as well as in
  product code — `new Date('2026-07-04')` is midnight UTC, which is the 3rd of
  July in New York.
- **Date arithmetic is in calendar days, not milliseconds.** Seven days across a
  DST boundary is an hour short of `7 * 86400000`.

### Firebase is mocked globally

`src/setupTests.js` replaces the entire Firebase SDK with the manual mocks in
`src/test-utils/mocks/`. **No test can reach a real backend**, even if it forgets
to mock. Mock state resets before every test.

To drive a specific response, import the mock module and stub it:

```js
import * as fs from '../../test-utils/mocks/firestore';

fs.getDocs.mockResolvedValueOnce(fs.__querySnapshot(asDocs([makeItem({ name: 'Milk' })])));
```

To feed a real-time listener, emit on the path the hook subscribes to. Wrap it
in `act()` because it triggers a React state update:

```js
await act(async () => {
  fs.__emit('users/test-uid/inventory', asDocs([makeItem({ name: 'Milk' })]));
});
```

Useful helpers on the firestore mock: `__emit`, `__emitDoc`, `__emitError`,
`__doc`, `__querySnapshot`, `__listenerCount` (assert cleanup), `pathOf` (assert
*where* a write went). The auth mock has `__setUser`, `__user`, `__authError`.

### Rendering with providers

Import from `src/test-utils` rather than RTL directly — it re-exports everything
RTL does, plus a render that wires up Router, AuthProvider, and ToastProvider:

```js
import { renderWithProviders, screen, authMock } from '../../test-utils';

renderWithProviders(<Inventory />, { route: '/inventory', user: authMock.__user() });
renderWithProviders(<Login />, { user: null });   // signed out
```

### Fixtures

`src/test-utils/factories.js` builds schema-valid documents so a test states only
what it cares about: `makeItem`, `makeLocation`, `makeRecipe`, `makeUserProfile`,
`daysFromNow(n)`, `asDocs(records)`.

**Keep factories in sync with `firestore/SCHEMA_DOCUMENTATION.md`.** They are the
shared definition of "a valid document" across the frontend suite.

### Contract tests between the frontend and the functions

Some logic genuinely has to exist in both packages — CSV validation runs in the
browser to show a preview and again in the Cloud Function because the server
must not trust the client. Where that happens, a *contract test* runs one shared
corpus through both implementations and asserts they agree:

| Contract | Test | Corpus |
| --- | --- | --- |
| CSV validation | `src/components/CSVImport/__tests__/csvValidation.contract.test.js` | `src/test-utils/csvContractCorpus.js` |

These live in the frontend suite because only that runner transpiles ESM; it
`require`s the CommonJS copy directly. **A change to either implementation
belongs in both, in the same commit** — and if it doesn't, this test is what
says so. Add a case to the corpus whenever you add a rule.

### Coverage

Thresholds are enforced in `package.json` and act as a ratchet — CI fails if
coverage drops below them. **When you add a feature, raise the floor** to just
under whatever your new tests achieve. Never lower a threshold to make a build
pass.

---

## Cloud Functions tests

```bash
npm run test:functions
```

Plain Jest in `functions/`. `firebase-admin` is mocked with a recording fake (see
`functions/src/triggers/__tests__/onUserCreate.test.js`) so tests assert *what*
was written to *which* path without an emulator.

`functions/index.test.js` is a contract test: every function the roadmap promises
must be exported. Add yours to `REQUIRED_EXPORTS` when you ship it.

---

## Firestore security rules tests

```bash
npm run test:rules
```

Runs `firestore/tests/firestore.rules.test.js` against the Firestore emulator
using the real `firestore/firestore.rules`. Needs Java (the emulator is a JVM
process).

**This is the suite that catches client/rules drift.** Firestore is currently in
test mode, so a client write that violates the rules still succeeds in
production — until roadmap step 10.2 switches it to production mode, at which
point it starts failing. These tests surface that today.

The fixtures at the top of the file (`validItem`, `validLocation`, `validRecipe`)
mirror what the app actually writes. **If you change a document shape, change the
fixture — and if the fixture then fails, the rules need updating too.**

---

## End-to-end tests

```bash
npm run test:e2e        # builds, starts auth+firestore emulators, runs Playwright
npm run test:e2e:only   # skips the build — only when build/ is already current
```

Playwright drives a real production build (`serve -s build`) against real
emulators, on desktop and mobile viewports. This is the only suite that exercises
the actual bundle, the service worker, and the real security rules together.

`e2e/fixtures.js` provides an `authedPage` fixture that starts already signed
in:

```js
const { test, expect } = require('./fixtures');

test('does the thing', async ({ authedPage: page }) => {
  await page.goto('/inventory');
});
```

### One account per worker

Every spec used to share a single seeded account, and every spec that wrote
left its writes behind. That cost twice: the suite got slower as it ran,
because each page load read a kitchen that had been growing since the first
spec, and a spec asserting an exact count passed until a later section added a
fixture that changed it — surfacing as a failure in a spec that had nothing to
do with the change.

`e2e/global-setup.js` now seeds one account per worker, each with the identical
kitchen (three storage locations, one item per expiration state), plus a
separate one for `auth.spec.js`. `e2e/accounts.js` derives which is which from
`TEST_PARALLEL_INDEX`, the variable Playwright sets in every worker process.

**You do not have to do anything to get this.** `e2e/firestore-admin.js`
resolves the same account the same way, so `inventoryItems()`, `mealPlanEntry()`
and friends already read the kitchen your browser is signed in to.

**The one thing it does not isolate is recipes.** `recipes` is a single global
collection by schema, not a per-user subcollection, so a recipe one worker
creates is visible to all of them. A spec that creates a recipe still has to use
a unique name.

There is no `setup` project any more. Each worker signs itself in once, in a
worker-scoped `storageState` fixture, and the logins run concurrently — so the
wall-clock cost is the same single login it always was.

A spec that needs to be signed *out* imports `signedOutTest` rather than `test`.
A worker-scoped fixture cannot be overridden with `test.use()` from inside a
file, so `test.use({ storageState: SIGNED_OUT_STATE })` on the normal test
object is an error rather than a signed-out browser.

### The empty kitchen, and no connection

`e2e/empty-states.spec.js` covers the two states nobody writes a fixture for
and everybody hits: the first five minutes after signing up, and a phone in a
kitchen with thick walls.

The `emptyPage` fixture signs in as `EMPTY_USER` — a cook with a profile and
the default shelves and nothing on them, which is exactly what the sign-up
function creates. It is shared across workers rather than per-worker, which is
safe **only because those specs read**. If you add one that writes, give it a
worker account instead.

The offline tests use `context.setOffline(true)` and then navigate **by
clicking**, not with `page.goto`. A goto is a full document request, so offline
it depends on the service worker having activated — a different thing to test
and a flakier one. Clicking is what a cook does and what a single-page app is
for. Where a spec does need a document request offline, wait for
`navigator.serviceWorker.controller` first.

### What the mobile project runs

Both browser projects used to run all 71 specs, which doubled the suite to pay
for re-asserting, at 412px, business logic that has nothing to do with width.

`mobile-chromium` now runs only the specs where being on a phone changes the
answer: `mobile.spec.js` (tap targets, horizontal overflow and the bottom nav,
across every page), `navigation.spec.js`, `auth.spec.js` and
`whats-new.spec.js`. Everything else is desktop-only.

If you add a spec whose subject is layout, tap size or navigation, add it to
`testMatch` in `playwright.config.js`. If it is about what the app *does*,
leave it out — the desktop run and the unit suite already cover that.

### Writing a spec that means something

Confirm a write from a client that never saw it. A write that passes client
validation but violates a security rule still renders locally, so the local view
proves nothing — open a second page and read it back:

```js
await expect(page.getByText(itemName)).toBeVisible();   // local state, weak
await expectFreshClientToSee(page, itemName, true);     // round trip, real
```

Use a second page rather than `page.reload()`. Reloading immediately after a
write stalls indefinitely: the service worker serves the navigation from
precache while the outgoing document's Firestore connection is still settling,
and the new document never reaches DOMContentLoaded.

Navigate with `{ waitUntil: 'domcontentloaded' }`. The default `load` waits on
Firestore's long-lived connection, which adds ~15s per navigation and can hang
outright.

---

## CI

`.github/workflows/ci.yml` runs seven jobs in parallel: `quality`, `unit`,
`functions`, `rules`, `build`, `e2e`, `secrets`. The `ci` job aggregates them and
is the single status check to protect `main` with.

**If you add a job, add it to `ci.needs`** — otherwise its failure won't block a
merge.

The `build` job also asserts `build/service-worker.js` exists. CRA only emits it
when `src/service-worker.js` is present and craco leaves CRA's `InjectManifest`
plugin intact; a regression there ships a PWA whose service worker registration
404s, with no other visible symptom.

`secrets` runs `.github/scripts/check-secrets.mjs`, a targeted scan for committed
credentials. `KNOWN_EXPOSED` in that script lists files already containing live
credentials that are being rotated out of band — remove entries as those files go
away.

---

## Version and changelog

The footer version tracks the roadmap: `0.<phase>.<step>`. When you complete a
roadmap step:

1. Bump `APP_VERSION`, `ROADMAP_STEP`, and `ROADMAP_STEP_NAME` in
   `src/config/version.js`.
2. Bump `version` in `package.json` to match.
3. Add a What's New entry in `src/config/whatsNew.js` (or put
   `[whats-new: none]` in a commit message if users truly won't notice).

`src/config/__tests__/version.test.js` fails the build if these drift apart, and
the `whats-new` workflow enforces step 3.
