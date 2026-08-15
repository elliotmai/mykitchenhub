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
npm test -- ItemCard     # one file
```

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

`e2e/global-setup.js` seeds a known account (`e2e-cook@example.com`) with three
storage locations and one item per expiration state. `e2e/fixtures.js` provides
an `authedPage` fixture that starts already signed in:

```js
const { test, expect } = require('./fixtures');

test('does the thing', async ({ authedPage: page }) => {
  await page.goto('/inventory');
});
```

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
