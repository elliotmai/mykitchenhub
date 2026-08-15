# Troubleshooting

Symptoms, causes and fixes, grouped by when you hit them.

- [Setting up](#setting-up)
- [Running the app](#running-the-app)
- [Emulators](#emulators)
- [Tests](#tests)
- [Build and deploy](#build-and-deploy)
- [Features that look broken but are not](#features-that-look-broken-but-are-not)

---

## Setting up

### `firebase: not found`

The Firebase CLI is a dev dependency of the `firestore/` package, not a global
tool.

```bash
npm install --prefix firestore
```

There are three `package.json` files in this repo — root, `functions/` and
`firestore/` — and `npm install` at the root does not reach the other two. If
anything behaves as though a dependency is missing, check you have run all
three:

```bash
npm install && npm install --prefix functions && npm install --prefix firestore
```

### `cp: .env.example: No such file or directory` from `setup.sh`

Fixed — `.env.example` is now in the repo. If you are on an older checkout, copy
the six `REACT_APP_FIREBASE_*` names out of the README into a `.env` by hand.

### `Missing Firebase config values: …` in the browser console

`.env` is missing or incomplete. Take the values from the Firebase console under
**Project settings → General → Your apps → SDK setup and configuration**.

Create React App reads `.env` **once, at start-up**. Editing it while
`npm start` is running changes nothing — stop the dev server and start it again.

### Java is not installed

The rules and end-to-end suites need it; the Firestore emulator is a JVM
process. Java 21 is what CI uses.

```bash
java -version    # should print 21.x
```

---

## Running the app

### Every page is blank, console shows a Firebase error

Almost always the config. See "Missing Firebase config values" above. If the
config is right, check the browser console for `permission-denied` — that is the
security rules, not the config.

### Signed in, but no storage locations and the Inventory page says to add some

Profile creation did not finish. It runs as the `onUserCreated` Cloud Function;
when `REACT_APP_FIREBASE_FUNCTIONS_URL` is unset or the function is unreachable,
the browser falls back to building the profile itself.

**That fallback writes storage locations keyed on `name` rather than `label`,
which the production security rules reject.** In test mode it works and the
locations render blank; with production rules on, signup fails outright. See
[DEPLOYMENT.md](./DEPLOYMENT.md#before-you-start-two-known-drifts) — this is
listed there as a fix-before-launch item.

Short term: set `REACT_APP_FIREBASE_FUNCTIONS_URL` so the real function runs.

### A write silently does nothing

Open the console. A `FirebaseError: Missing or insufficient permissions` means
the document violated a rule. The usual causes:

| Message context | Likely cause |
| --- | --- |
| Creating anything | A required field is missing — check the field list in `firestore.rules` |
| Updating a recipe | The patch included `name`, `createdAt` or `source`, all immutable |
| Updating an inventory item | The patch included `addedAt`, or moved it to a `locationType` outside fridge/freezer/pantry |
| Updating a storage location | The patch changed `isDefault`, which is immutable |
| Anything under `users/{someoneElse}` | You are signed in as a different account |

`firestore/tests/firestore.rules.test.js` is the fastest way to confirm a shape:
add a case with the document you are trying to write and see whether it passes.

### The app is showing an old version after a deploy

The service worker serves the previous build until it is replaced. You should
get a refresh prompt; if not, hard-reload, or clear the site data. Check the
version in the footer to confirm which build you are actually on.

### `permission-denied` reading `recipes`

Recipes are readable by any signed-in user and by nobody else. If you are seeing
this, the session is not authenticated — check whether the auth listener has
resolved before the read fires.

---

## Emulators

### `Could not start Firestore Emulator, port taken`

A previous emulator is still holding the port. This happens when a test run is
interrupted — killing the npm process does not always kill the JVM.

```bash
pkill -f cloud-firestore-emulator
pkill -f firebase-tools
```

Then confirm the ports are free before retrying:

```bash
ss -lntp | grep -E ':8080|:4400|:4500|:9099'
```

### `Port 8080 is available on 127.0.0.1 but not ::1`

A warning, not an error — the environment has no IPv6. The emulator starts and
the suites pass. Ignore it.

### `You are not currently authenticated`

Also just a warning. `emulators:exec` does not need a Firebase login for the
local emulator, and the rules and e2e suites run fine without one.

### Emulator data survives between runs and confuses a test

`emulators:exec` starts clean each time. Inside the rules suite, `beforeEach`
calls `testEnv.clearFirestore()`. If you started the emulators by hand with
`emulators:start`, data persists for as long as that process lives — restart it.

---

## Tests

### `npm run validate` passes but CI fails

`validate` is lint + format + unit + build. It does not run the functions, rules
or e2e suites. Run those too:

```bash
npm run test:functions
npm run test:rules
npm run test:e2e
```

### The build fails on something `npm test` was happy with

An ESLint **warning**. The production build runs under `CI=true`, which promotes
every warning to a compile error, so an unused import is enough to fail the
`build` and `e2e` jobs while the unit suite stays green.

`npm run lint` is pinned to `--max-warnings=0` and covers `e2e/` as well as
`src/`, so it fails on exactly what the build fails on — in forty seconds rather
than four minutes:

```bash
npm run lint
npm run lint:fix   # for the ones that fix themselves
```

Fix the warning rather than suppressing it with a disable comment.

### A unit test hangs or times out on a hook

The hooks subscribe with `onSnapshot`; they do not resolve a promise. Emit on
the path the hook subscribed to, and wrap it in `act()` because it causes a
React state update:

```js
await act(async () => {
  fs.__emit('users/test-uid/inventory', asDocs([makeItem({ name: 'Milk' })]));
});
```

`fs.__listenerCount()` tells you whether the hook subscribed where you think it
did — and is also how you assert it cleaned up.

### A rules test fails after a schema change

That is the suite doing its job. The fixtures at the top of the file mirror what
the app writes; if a fixture now fails, either the fixture is out of date or the
rules are. Fix whichever is wrong — and remember that all four of rules, schema
doc, rules test and `src/test-utils/factories.js` change together, in one commit.

### The e2e suite fails on a navigation that never completes

Navigate with `{ waitUntil: 'domcontentloaded' }`. The default `load` waits on
Firestore's long-lived connection, which adds around 15 seconds per navigation
and can hang. Do not use `page.reload()` straight after a write — read the write
back through `e2e/firestore-admin.js` instead.

### The e2e suite fails on stale content

`npm run test:e2e` builds first for exactly this reason. `test:e2e:only` skips
the build and serves whatever is in `build/` — only use it when you know that
directory is current.

### Coverage fails the build

Thresholds in `package.json` are a ratchet. **Do not lower one to get green.**
Coverage dropped because something new is untested; write the test. Look at
`coverage/lcov-report/index.html` to find what.

### A test tries to reach the network

It should not be able to. `src/setupTests.js` mocks the whole Firebase SDK
globally, the functions tests use a recording `firebase-admin` fake, and every
HTTP client in `functions/src` is injectable. If a test is reaching out, it is
constructing its own client instead of taking the injected one.

---

## Build and deploy

### `build/service-worker.js` missing

CRA only emits it when `src/service-worker.js` exists and craco leaves CRA's
`InjectManifest` plugin intact. If a change to `craco.config.js` dropped the
plugin, the PWA ships with a service worker registration that 404s and no other
visible symptom. The `build` CI job checks for the file for this reason.

### The secret scan fails

`.github/scripts/check-secrets.mjs` found a credential pattern in a tracked
file. Remove it, **rotate it**, and load it from an environment variable or a
GitHub secret instead. Removing it from the working tree is not enough — it is
still in the history.

`KNOWN_EXPOSED` in that script lists the two service-account files that already
contain live credentials and are being rotated out of band. Do not add to that
list to silence a new finding.

### Functions deploy did not run

`.github/workflows/deploy-functions.yml` only triggers on pushes to `main` that
touch `functions/**` or the workflow itself. A change elsewhere will not deploy
functions, which is intended.

---

## Features that look broken but are not

These are all deliberate degradations. Each one is a feature declining to be
load-bearing on an API key.

| What you see | What it means |
| --- | --- |
| "Automatic import is off on this build" on the HelloFresh page | `REACT_APP_FIREBASE_FUNCTIONS_URL` is unset. Manual recipe entry still works |
| Photo import returns `vision-not-configured` | No `ANTHROPIC_API_KEY` on the functions. Use the link tab or type it in |
| "Built this plan from what is in your kitchen — the AI planner is unavailable" | No `ANTHROPIC_API_KEY`. You still get a real week, planned around what is expiring |
| The daily waste alert arrives in the app but never as a text | Expected. There is no SMS provider key for this project, and the in-app notification is the channel that always works |
| Analytics page says "No shopping history yet" | Nothing has a price and a store yet. Those are optional fields on Add Item; the page is built entirely from them |
| The legacy sync imports recipes tagged `needs-instructions` | Neither Spoonacular nor Claude could supply instructions for that recipe. The recipe is still worth having, and the tag is how you find them later |
| Firebase Analytics never reports | Expected unless `REACT_APP_FIREBASE_MEASUREMENT_ID` is set, and it is switched off entirely against the emulators. An ad blocker also switches it off, which is fine |

If a missing key ever causes a hard failure rather than one of these, that is a
bug — see CONTRIBUTING §3.
