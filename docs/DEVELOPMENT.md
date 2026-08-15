# Developer guide

How this app is put together, and the two rules that explain most of its shape.

[CONTRIBUTING.md](../CONTRIBUTING.md) is the working agreement — read that
first if you are about to change something. [TESTING.md](../TESTING.md) is the
reference for writing tests. This document is the map.

- [Architecture](#architecture)
- [Where things live](#where-things-live)
- [The schema contract](#the-schema-contract)
- [The four test suites](#the-four-test-suites)
- [Running the emulators](#running-the-emulators)
- [CI](#ci)
- [Version and changelog](#version-and-changelog)

---

## Architecture

```
   Browser (React SPA, installable PWA)
      │
      ├──── Firebase Auth ─────────── email/password sessions
      │
      ├──── Firestore ─────────────── all reads and writes, through security rules
      │        (real-time listeners; the UI is never told to refresh)
      │
      ├──── Cloud Storage ─────────── recipe images, HelloFresh card photos
      │
      └──── Cloud Functions ───────── the things a browser must not do
               │
               ├── onUserCreated ............ builds the profile + default locations
               ├── importInventoryFromCSV .... server-side bulk import
               ├── importHelloFreshFromPhoto . Claude Vision reads a recipe card
               ├── importHelloFreshFromUrl ... scrapes a HelloFresh link
               ├── generateMealPlan .......... Claude plans a week
               ├── syncLegacyRecipes ......... imports the "Let's Eat" library
               ├── sendDailyWasteAlerts ...... 9 AM scheduled sweep
               └── create/update/deleteStorageLocation
```

Three things are worth knowing before you read any of it.

**The client owns its own writes.** Functions that produce data — the HelloFresh
importers, `generateMealPlan` — parse and return; they do not write. The browser
writes the result under the signed-in user's own credentials, so every write
goes through the same security rules as one the user made by hand. There is no
privileged path that skips validation.

The exceptions are deliberate and few: `onUserCreated` (there is no session yet),
`syncLegacyRecipes` (it needs credentials for a second Firebase project), and
`sendDailyWasteAlerts` (it runs on a schedule with nobody signed in). Those use
the Admin SDK and **bypass security rules entirely** — which is exactly why the
rules tests cannot be the only thing checking what they write.

**Firestore access lives in hooks.** Components render; hooks talk to the
database. `useInventory`, `useRecipes`, `useMealPlan` and the rest own their
listeners, their optimistic updates and their error handling, and return plain
data plus callbacks. A component that imports from `firebase/firestore` is doing
something wrong.

**Reads are real-time.** Hooks subscribe with `onSnapshot` rather than fetching.
Two consequences: a write made anywhere shows up everywhere without a refresh,
and a test that drives a hook has to emit on the path the hook subscribed to
(`fs.__emit(...)`, wrapped in `act()`) rather than resolving a promise.

**Every external service degrades.** No API key is allowed to be load-bearing.
Without `ANTHROPIC_API_KEY` the meal planner builds a week locally and says so;
photo import returns `vision-not-configured` and the UI offers manual entry.
Without an SMS provider the daily alert writes an in-app notification, which is
the channel that always works. This is a rule, not a courtesy — see
CONTRIBUTING §3.

---

## Where things live

```
src/
  components/<Feature>/     the feature's components, its tests, its index.js
  hooks/use<Thing>.js       one hook per data concern; all Firestore access
  pages/<Page>.jsx          one per route, thin — wires hooks to components
  services/
    firebase.js             SDK setup and emulator wiring
    analytics.js            GA4, off unless configured
    helloFreshApi.js        the HTTP calls to the import functions
  config/
    version.js              APP_VERSION / ROADMAP_STEP — the footer
    whatsNew.js             the changelog the popup renders
  styles/design-system.css  colour and spacing tokens; charts read these too
  test-utils/               render helpers, factories, and the Firebase mocks

functions/
  index.js                  exports only — one line per function
  src/<feature>/            the implementation, with __tests__ beside it

firestore/
  firestore.rules           what is actually deployed
  storage.rules             Cloud Storage equivalent
  firestore.indexes.json    composite indexes
  SCHEMA_DOCUMENTATION.md   every document shape, field by field
  tests/                    the rules suite

e2e/                        Playwright specs, fixtures, and the emulator seed
docs/                       these guides
```

Feature directories are owned outright by whoever builds the feature. **Shared
files are append-only** — `src/App.jsx`, the `index.js` barrels,
`functions/index.js`, `package.json`. Add your line; do not reorder or reformat
around it. CONTRIBUTING §1 has the table.

`functions/index.js` is exports and nothing else. If you are writing logic in
it, it belongs in `functions/src/<feature>/`.

---

## The schema contract

This is the rule that has caused the most real bugs, so it gets its own section.

Three places have to agree about the shape of every document:

1. `firestore/firestore.rules` — what the database will accept
2. `firestore/SCHEMA_DOCUMENTATION.md` — what we say it is
3. the code that writes it — the hooks and the Cloud Functions

They have drifted before, with results that were invisible until they weren't:
storage locations written with `name` where the rules and the UI expect `label`,
so every location rendered blank; inventory written with `addedBy` instead of
`source`, so the rules would have rejected it the moment they were enforced.

Before writing a document from any layer, check the required fields in
`firestore.rules`. If you need a new field or collection, change **all four of
these in the same commit**:

1. `firestore/firestore.rules`
2. `firestore/SCHEMA_DOCUMENTATION.md`
3. a case in `firestore/tests/firestore.rules.test.js`
4. the matching factory in `src/test-utils/factories.js`

The fixtures at the top of the rules test file (`validItem`, `validLocation`,
`validRecipe`, …) are meant to mirror what the app actually writes. If you
change a shape, change the fixture — and if the fixture then fails, the rules
need updating too. That failure is the whole point of the suite.

### Rules to read before writing a write

A few constraints are easy to trip over because they are enforced on **update**
as well as create, and `request.resource` in a rule is the *resulting* document,
not your patch:

- Immutable everywhere: `createdAt`, and `addedAt` on inventory items.
- Immutable on recipes: `name`, `source`, `createdBy`. `src/hooks/useRecipes.js`
  strips those from every patch rather than sending them and being rejected.
- Immutable on storage locations: `isDefault`.
- Enum fields (`locationType`, `source`, `status`, `mealType`, `difficulty`) are
  checked on update too, so an edit cannot move a document out of the vocabulary
  the queries rely on.
- Required field sets are re-checked on update, so a patch cannot leave a
  document without the fields the UI renders.

`users/{userId}/importHistory` is append-only by design: `allow update: if false`.
A log entry describes something that already happened.

---

## The four test suites

Each covers something the others structurally cannot. All four run on every pull
request. [TESTING.md](../TESTING.md) is the how-to; this is the why.

| Suite | Command | Covers what nothing else can |
| --- | --- | --- |
| Frontend unit/component | `npm run test:ci` | Behaviour of hooks and components in isolation, including error paths that are hard to provoke for real |
| Cloud Functions | `npm run test:functions` | Backend logic and reference data, against mocked `firebase-admin` and mocked HTTP — no emulator, no network, no spend |
| Firestore rules | `npm run test:rules` | What the deployed database will actually allow. The only suite that runs the real `firestore.rules` |
| End-to-end | `npm run test:e2e` | The real production bundle, the service worker, and the real rules, all at once |

`npm run validate` runs lint + format + unit + build. It is the fast local
pre-push check and does **not** include the functions, rules or e2e suites — run
those too before a final push.

### Frontend

Jest and React Testing Library through `craco test`. `src/setupTests.js`
replaces the entire Firebase SDK — app, auth, firestore, storage, functions and
analytics — with the manual mocks in `src/test-utils/mocks/`. No test can reach
a real backend even if it forgets to mock one.

Render through `renderWithProviders` from `src/test-utils` rather than RTL
directly; it wires up Router, AuthProvider and ToastProvider. Build documents
with the factories (`makeItem`, `makeLocation`, `makeRecipe`, `makeUserProfile`)
so a test states only what it actually cares about.

**Contract tests** live here too. CSV validation genuinely has to exist twice —
in the browser for the preview, and in the Cloud Function because the server must
not trust the client. `csvValidation.contract.test.js` runs one shared corpus
through both implementations and asserts they agree. Change either side and the
other must change in the same commit; this test is what says so.

**Coverage is a ratchet.** Thresholds live in `package.json`. Raise the floor
when your tests push coverage up. Never lower one to make a build pass — if
coverage dropped, the missing test is the fix.

### Cloud Functions

Plain Jest in `functions/`. `firebase-admin` is a recording fake, so a test
asserts *what* was written to *which* path without an emulator. Every HTTP
client is injected, so no test can call a paid API — a test suite that costs
money is a broken test suite.

`functions/index.test.js` is a contract test: every function the roadmap
promises must be exported. Add yours to `REQUIRED_EXPORTS` when you ship it.

### Rules

Runs `firestore/tests/firestore.rules.test.js` against the Firestore emulator
using the real rules file. **Needs Java 21.**

This is the suite that catches client/rules drift. While Firestore is in test
mode a violating client write still succeeds in production — it starts failing
the moment production rules go on. These tests surface that today, which is what
makes the switch in [DEPLOYMENT.md](./DEPLOYMENT.md) safe to make.

### End-to-end

Playwright drives `serve -s build` — a real production build — against real
emulators, on desktop and mobile viewports. `e2e/global-setup.js` seeds
`e2e-cook@example.com` with three storage locations, one item per expiration
state and two recipes. `e2e/fixtures.js` gives you an `authedPage` that starts
signed in.

Two things about writing e2e specs that are not obvious and will cost you an
afternoon each:

**Confirm a write against the database, not the screen.** The UI renders its own
writes optimistically, so a write that violates a security rule looks identical
to one that succeeded until you read it back from somewhere else. Read it back
through `e2e/firestore-admin.js`, which queries the emulator directly from the
test process — `inventoryHasItem`, `mealPlanEntry`, `deliveries` and friends:

```js
const { inventoryHasItem } = require('./firestore-admin');

await expect(page.getByText(itemName)).toBeVisible();   // local state, weak
expect(await inventoryHasItem(itemName)).toBe(true);    // round trip, real
```

A second browser page would be more end-to-end, but a service-worker-controlled
navigation issued while a Firestore connection is still settling never resolves
for Playwright — it hangs rather than fails. `page.reload()` straight after a
write has the same problem.

**Navigate with `{ waitUntil: 'domcontentloaded' }`.** The default `load` waits
on Firestore's long-lived connection, which adds around 15 seconds per
navigation and can hang outright.

---

## Running the emulators

The Firebase CLI comes from `firestore/node_modules`, so install that package
first:

```bash
npm install --prefix firestore
firestore/node_modules/.bin/firebase emulators:start --only auth,firestore,functions,storage
```

| Emulator | Port |
| --- | --- |
| Auth | 9099 |
| Firestore | 8080 |
| Functions | 5001 |
| Storage | 9199 |
| Emulator UI | 4000 |

Set in [firebase.json](../firebase.json). Point the app at them with
`REACT_APP_USE_EMULATORS=true npm start`.

That flag is deliberately **not** gated on `NODE_ENV`: the e2e suite runs a
production build against the emulators, and a `NODE_ENV` check would silently
point that build at the real project. It also switches Analytics off, so local
and e2e sessions never land in the production GA4 property.

The emulators are JVM processes. If a suite fails with "port taken" after an
interrupted run, a previous emulator is still holding the port — see
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## CI

`.github/workflows/ci.yml` runs seven jobs in parallel — `quality`, `unit`,
`functions`, `rules`, `build`, `e2e`, `secrets` — and a `ci` job that aggregates
them. **`ci` is the single status check to protect `main` with.** If you add a
job, add it to `ci.needs`, or its failure will not block a merge.

Two jobs are less obvious than they look:

- **`build`** also asserts `build/service-worker.js` exists. CRA only emits it
  when `src/service-worker.js` is present and craco leaves CRA's `InjectManifest`
  plugin intact. A regression there ships a PWA whose service worker
  registration 404s, with no other visible symptom.
- **`secrets`** runs `.github/scripts/check-secrets.mjs`, a targeted scan for
  committed credentials — high-signal patterns only, so it stays trustworthy
  rather than becoming something people learn to ignore. `KNOWN_EXPOSED` lists
  files that already contain live credentials and are being rotated out of band;
  remove entries as those files go away.

CI does not run automatically on `claude/**` branches — work in progress pushes
many times and every red run emails the repo owner. Validate locally, or trigger
the workflow by hand from the Actions tab.

`.github/workflows/deploy-functions.yml` deploys Cloud Functions on any push to
`main` that touches `functions/`.

---

## Version and changelog

The footer version tracks the roadmap: `0.<phase>.<step>`. Finishing roadmap step
10.2 means `APP_VERSION` is `0.10.2`. The leading zero stays until the roadmap is
done and the app ships 1.0.0.

When you complete a step:

1. Set `APP_VERSION`, `ROADMAP_STEP` and `ROADMAP_STEP_NAME` in
   `src/config/version.js`.
2. Set `version` in `package.json` to match.
3. Add an entry at the top of `src/config/whatsNew.js`, dated `YYYY.MM.DD` (or
   `YYYY.MM.DD.N` for a second release the same day). Write it for someone
   cooking dinner, not for a developer: what changed for *them*.

`src/config/__tests__/version.test.js` fails the build if these drift apart, and
the `whats-new` workflow enforces step 3. If a change genuinely isn't
user-visible, put `[whats-new: none]` in the commit message instead.

Two things about the ordering, both of which look like off-by-one bugs until you
know them:

- What's New versions are date strings compared **numerically**, so
  `2026.08.14.10` sorts after `2026.08.14.9` rather than before it. The test
  asserts the list is newest-first under that comparison.
- `APP_VERSION` is a roadmap coordinate, not a date, so `0.10.3` is *later* than
  `0.9.4` — phase 10 follows phase 9. The version test checks the scheme and
  that the phase is within 0–10; it does not compare releases to each other.
