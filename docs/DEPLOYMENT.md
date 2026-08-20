# Production deployment runbook

Roadmap 10.2. Everything here is for the **repo owner** to run. None of it has
been executed — each step either costs money, changes live data, or needs
console access that a build agent should not have.

Work through it in order. Step 7 is the one that changes how the live database
behaves, and it is the reason all the earlier steps exist.

Steps 4, 7, 8 and 11 are now buttons rather than commands — see
[What runs itself](#what-runs-itself) below. The commands are kept under each
step because they are what the button runs, and because you will want them if a
deploy ever has to happen from a laptop.

- [Before you start: the two schema drifts are fixed](#before-you-start-the-two-schema-drifts-are-fixed)
- [Before you start: rotate the committed credentials](#before-you-start-rotate-the-committed-credentials)
- [What runs itself](#what-runs-itself)
- [1. Confirm what you are deploying to](#1-confirm-what-you-are-deploying-to)
- [2. Set the Cloud Functions environment](#2-set-the-cloud-functions-environment)
- [3. Lock down who can start the legacy sync](#3-lock-down-who-can-start-the-legacy-sync)
- [4. Deploy the indexes](#4-deploy-the-indexes)
- [5. Deploy the Cloud Functions](#5-deploy-the-cloud-functions)
- [6. Turn on Firebase Analytics](#6-turn-on-firebase-analytics)
- [7. Switch Firestore out of test mode](#7-switch-firestore-out-of-test-mode)
- [8. Deploy the Storage rules](#8-deploy-the-storage-rules)
- [9. Set a billing budget](#9-set-a-billing-budget)
- [10. Set up monitoring and alerting](#10-set-up-monitoring-and-alerting)
- [11. Deploy the frontend](#11-deploy-the-frontend)
- [Rolling back](#rolling-back)

---

## Before you start: the two schema drifts are fixed

This section used to list two places that wrote documents the production rules
would reject. Both are fixed; it is kept because the failure they would have
caused is worth recognising if anything like it comes back.

**1. The client signup fallback wrote the wrong shape.** When `onUserCreated`
was unreachable — no functions URL, a cold start, a deploy in progress — the
browser built the profile itself, keying storage locations on `name` where the
rules and the UI expect `label`, and omitting the top-level `helloFresh` the
rules require on create. Under production rules both writes are denied, so a
cook who hit that path would have ended up with an auth account and no profile
behind it, and signing up again just says the email is taken. It only ever
worked because the database was in test mode. `src/hooks/useAuth.js` now writes
the documented shape, and `firestore/tests/firestore.rules.test.js` runs the
payloads that file actually builds against the real rules.

**2. `helloFresh` lived in two places.** `onUserCreate` seeded the settings under
`preferences.helloFresh` while `useDeliveries` wrote them top-level. That was
not cosmetic: `readHelloFresh` in `functions/src/mealPlan/planContext.js` reads
`profile.helloFresh` and nothing else, so the meal planner never saw the seeded
delivery days. Both writers now use the documented top-level field.

## Before you start: rotate the committed credentials

`functions/service-account.json` and `functions/legacy-firebase-service-account.json`
contain live credentials and are committed to this repository.

**No application code reads either file.** Everything resolves credentials from
`process.env` or Firebase Functions config, and
`.github/scripts/check-secrets.mjs` lists them in `KNOWN_EXPOSED` so it reports
_new_ leaks rather than re-reporting these on every run. They are dead weight
that is also a live risk.

They need to be:

1. **Rotated.** Google Cloud console → **IAM & Admin → Service Accounts** →
   the account → **Keys** → create a new key, then delete the old one. Do the
   same in the legacy "Let's Eat" project for its account. Anything still using
   the old key stops working the moment you delete it, so create first.
2. **Removed from the working tree** — `git rm` both files.
3. **Purged from history.** Deleting a file does not un-publish it; the old blob
   stays reachable. Use `git filter-repo` or the BFG, then force-push, and
   remove the two entries from `KNOWN_EXPOSED` in the secret-scan script.

Note that `.github/workflows/deploy-functions.yml` writes a
`functions/service-account.json` at deploy time from the `FIREBASE_SERVICE_ACCOUNT`
secret and deletes it afterwards. That is fine and should keep working — update
the secret to the new key when you rotate.

---

## What runs itself

Three workflows deploy this project. All of them use credentials the repository
already holds, so none of them needs a new account or secret.

| Workflow               | Deploys                                 | Fires                                                                      |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `deploy-functions.yml` | Cloud Functions                         | automatically, on any push to `main` touching `functions/**`               |
| `deploy-rules.yml`     | Firestore rules, indexes, Storage rules | **button** (Actions -> Deploy Firestore rules and indexes -> Run workflow) |
| `deploy-hosting.yml`   | the web app                             | **automatic**, on every `main` commit that passes CI                       |

The frontend publishes itself. `deploy-hosting.yml` triggers on `workflow_run`
after CI concludes on `main`, and runs only if that run's conclusion was
`success` — so a commit whose tests failed never reaches production, and the
commit that gets built is the one CI actually tested (`workflow_run.head_sha`),
not whatever is at the tip of `main` by the time the deploy starts.

A `push` trigger would not do: it fires the moment the commit lands, in parallel
with CI, so a red build would already be live by the time anyone saw the X.

Rules stay on the button. Set the repository variable `AUTO_DEPLOY_RULES` to
`true` (Settings -> Secrets and variables -> Actions -> Variables) to have them
deploy on every push to `main` as well. Both buttons keep working either way,
for any branch.

Rules deploy only after `npm run test:rules` passes in the same job: a bad rule
either locks every cook out of their own kitchen or opens everyone's to
everyone, and the suite that proves the file correct takes twenty seconds.

The frontend refuses to publish a build whose bundle does not name the project
being deployed to. Firebase config is inlined at build time, so that one check
catches both a build made against the emulators and a build whose secrets never
arrived — either of which would point every visitor at the wrong database, or at
`localhost`.

**Pressing the rules button for the first time is step 7.** It replaces
test-mode rules with the real ones. Read that step before you press it.

---

## 1. Confirm what you are deploying to

```bash
cat .firebaserc          # projects.default — the Firebase project id
firestore/node_modules/.bin/firebase login
firestore/node_modules/.bin/firebase use default
firestore/node_modules/.bin/firebase projects:list
```

Confirm the project id matches `REACT_APP_FIREBASE_PROJECT_ID` in whatever
environment builds the frontend. A mismatch means the app and the rules are
pointed at different databases, and every step below would appear to succeed
while doing nothing.

Cloud Functions and Cloud Scheduler both need the **Blaze** (pay-as-you-go)
plan. Firebase console → ⚙ → **Usage and billing → Details & settings**.

---

## 2. Set the Cloud Functions environment

Set the values documented in [the README](../README.md#cloud-functions--functionsenv-or-firebase-functions-config).
Set them as function environment variables in the Google Cloud console —
**Cloud Functions → the function → Edit → Runtime, build … → Runtime environment
variables** — or, for the paths that accept it, as Firebase Functions config:

```bash
firebase functions:config:set anthropic.key="…"
firebase functions:config:set legacy.service_account="$(base64 -w0 path/to/lets-eat-key.json)"
```

Note that `firebase.json` sets `"disallowLegacyRuntimeConfig": true` on the
functions codebase, so prefer environment variables and treat the config route as
the fallback it is.

At minimum, for everything to work:

| Variable                          | Why now                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`               | HelloFresh photo import, AI meal plans, legacy sync instructions              |
| `SPOONACULAR_API_KEY`             | Legacy sync instruction lookup (much cheaper than Claude)                     |
| `LEGACY_FIREBASE_SERVICE_ACCOUNT` | The legacy sync's only route to the old project — use the **new** rotated key |
| `SYNC_ADMIN_UIDS`                 | See the next step                                                             |

Nothing here needs an SMS key. Leave SMS unset unless and until you have a
provider — see
[INITIAL_DATA_SETUP.md](./INITIAL_DATA_SETUP.md#3-configuring-sms-alerts).

---

## 3. Lock down who can start the legacy sync

`syncLegacyRecipes` is callable, and **with `SYNC_ADMIN_UIDS` unset any signed-in
user can start a run that spends real money.** The `LEGACY_SYNC_MAX_COST_USD`
ceiling bounds the damage but does not prevent it.

Get your own uid from Firebase console → **Authentication → Users**, then set:

```
SYNC_ADMIN_UIDS=<your-uid>
```

Do this before step 5, so the function is never deployed in the open state.

---

## 4. Deploy the indexes

Indexes first, rules second. A missing composite index makes a query fail even
when the rules would have allowed it, and building one on a populated collection
is not instant — you want them ready before traffic depends on them.

```bash
firestore/node_modules/.bin/firebase deploy --only firestore:indexes
```

Six composite indexes are defined in `firestore/firestore.indexes.json`:
`inventory` by locationType+expiresAt and locationId+expiresAt, `recipes` by
tags+createdAt and source+createdAt, `mealPlanEntries` by date+mealType, and
`storageLocations` by type+order.

Watch them build: Firebase console → **Firestore Database → Indexes**. Wait for
every one to read **Enabled** before continuing.

---

## 5. Deploy the Cloud Functions

Pushing to `main` with a change under `functions/` runs
`.github/workflows/deploy-functions.yml` automatically. To do it by hand:

```bash
cd functions && npm ci
firebase deploy --only functions
```

Check afterwards, in Firebase console → **Functions**, that the ten the app
depends on are listed: `onUserCreated`, `syncLegacyRecipes`,
`importInventoryFromCSV`, `importHelloFreshFromPhoto`, `importHelloFreshFromUrl`,
`sendDailyWasteAlerts`, `generateMealPlan`, `createStorageLocation`,
`updateStorageLocation`, `deleteStorageLocation`. That list is
`REQUIRED_EXPORTS` in `functions/index.test.js`, which fails the build if one
goes missing.

Four more deploy alongside them — `seedTestData`, `clearTestData`,
`seedInventoryHttp`, `seedRecipesHttp` — and should not stay. See below.

Two things to verify while you are there:

- **`sendDailyWasteAlerts` created its schedule.** Deploying a scheduled function
  creates a Cloud Scheduler job. Google Cloud console → **Cloud Scheduler** —
  there should be a job running `0 9 * * *` in `America/New_York`. If it is
  missing, the daily alert will never fire and nothing will report an error.
- **The runtime.** `firebase.json` pins `nodejs20`, but `functions/package.json`
  still declares `"engines": { "node": "18" }`, and the deploy workflow sets up
  Node 18. The `firebase.json` runtime wins for the deployed function, but the
  three should agree — worth reconciling on 20, which is what CI tests against.

### The seed functions

`seedTestData`, `clearTestData`, `seedInventoryHttp` and `seedRecipesHttp` are
development helpers, and each one takes the account to act on from its own
request rather than from a verified session:

- `seedInventoryHttp` and `seedRecipesHttp` are HTTP functions with
  `Access-Control-Allow-Origin: *` and **no authentication at all**. They read
  `userId` from the query string or body. Anyone who learns the URL can write
  into any account.
- `seedTestData` is callable and has its `context.auth` check commented out.
- `clearTestData` is callable and takes `data.userId` in preference to the
  caller's own uid — so it **deletes another account's inventory and recipes on
  request**.

They exist to make development pleasant and they are the sharpest edge in the
deployed surface.

**Do not leave these in production.** They are not in `REQUIRED_EXPORTS`, so
removing them does not break the contract test. Delete the four `exports` lines
from `functions/index.js` before deploying, or remove the functions afterwards:

```bash
firebase functions:delete seedTestData clearTestData seedInventoryHttp seedRecipesHttp
```

---

## 6. Turn on Firebase Analytics

The app is wired for it and stays silently off until this is configured, so this
step is safe to do at any point.

1. Firebase console → ⚙ **Project settings → Integrations → Google Analytics** →
   **Enable**, and link or create a GA4 property.
2. **Project settings → General → Your apps → the web app**. The config now
   includes a `measurementId` (`G-XXXXXXXXXX`).
3. Set `REACT_APP_FIREBASE_MEASUREMENT_ID` to that value in the frontend build
   environment (Netlify → **Site configuration → Environment variables**), and in
   the `build` job's environment if you want CI builds to match.
4. **Turn on history-based page views.** GA4 → **Admin → Data streams** → the web
   stream → **Enhanced measurement** → gear icon → enable **Page changes based on
   browser history events**.

   This matters more than it sounds. MyKitchenHub is a single-page app: after the
   first load, navigation never fetches a new document. Without this setting, GA4
   records exactly one page view per session and every screen after the first is
   invisible. The app deliberately does **not** send page views itself — doing
   both would double-count every screen.

5. Redeploy the frontend, open it, and check Firebase console → **Analytics →
   Realtime**. Give it a few minutes.

Analytics stays off automatically when `REACT_APP_USE_EMULATORS=true`, so local
work and the end-to-end suite can never pollute the property.

---

## 7. Switch Firestore out of test mode

**This is the highest-risk step in the runbook.** Until now every write has been
accepted. After it, only writes that satisfy `firestore/firestore.rules` are, and
anything in the app that has been quietly writing the wrong shape starts failing
for real users.

### What makes this safe

`firestore/tests/firestore.rules.test.js` — over 200 cases running the **real**
rules file against the Firestore emulator. Its fixtures mirror what the app actually
writes, so a shape the app produces and the rules reject fails there rather than
in production. That suite is the evidence, and running it is not optional:

```bash
npm run test:rules      # every case green, no exceptions
npm run test:e2e        # the real bundle against the real rules
```

`test:e2e` is the second half of the proof. It runs a production build against
emulators loaded with these rules and drives the real flows, so it catches a
denial the unit tests mock away.

If either suite is red, **stop**. A red rules suite is the system telling you
this switch will break something.

Also confirm you have handled the two drifts at the top of this document, since
neither suite covers the client-side signup fallback end to end.

### Doing it

```bash
npm run test:rules && npm run test:e2e     # both green, no exceptions
firestore/node_modules/.bin/firebase deploy --only firestore:rules
```

Firebase console → **Firestore Database → Rules** should now show the deployed
file and the "your database is public" banner should be gone.

### What to check straight afterwards

Do these yourself, in the live app, in this order — they are the paths most
likely to break, and the first three are all first-run paths that nobody
exercises again once they work:

1. **Sign up a brand new account.** Confirm the profile is created and the four
   default storage locations appear **with their names** (not blank). This is the
   drift from the top of this document; blank labels mean the fallback ran.
2. **Add an inventory item**, then edit it, then move it to the freezer and check
   the expiry date moved out.
3. **Add a storage location**, rename it, and delete it.
4. **Add a recipe**, edit its servings, mark it cooked, delete it.
5. **Open an imported recipe** and mark it cooked — this is the shared-library
   path, and it must work on a recipe you did not create.
6. **Import a small CSV** — three rows — and confirm the import history entry.
7. **Log a HelloFresh delivery** and confirm ingredients reached the fridge and
   meals reached the plan.
8. **Schedule a meal, drag it to another day, mark it cooked**, and confirm the
   ingredients came out of inventory.

Then watch **Firestore → Usage** and the denial metric from step 10 for the first
24 hours. A spike in `PERMISSION_DENIED` after this switch is not an attack, it
is a shape the tests did not cover.

---

## 8. Deploy the Storage rules

```bash
firestore/node_modules/.bin/firebase deploy --only storage
```

`firestore/storage.rules` is already restrictive — authenticated-only, 10 MB cap,
image content types, per-user paths for HelloFresh photos and profile pictures,
and `write: if false` on the legacy-sync image path.

Two things worth knowing rather than changing blind:

- **Recipe images are writable and deletable by any authenticated user.** That
  mirrors the shared recipe library in Firestore, where anyone may edit any
  recipe. It does mean one signed-in user can delete another's recipe photo.
  Acceptable for a household; not if this ever opens up.
- There is no Cloud Function cleaning up `/temp/{userId}/`, despite the comment
  in the file promising a 24-hour sweep. Either write one or set a lifecycle rule:
  Google Cloud console → **Cloud Storage → the bucket → Lifecycle → Add a rule**
  → delete objects older than 1 day, prefix `temp/`.

---

## 9. Set a billing budget

Do this before the first legacy sync run, not after.

1. Google Cloud console → **Billing → Budgets & alerts → Create budget**.
2. Scope it to this project.
3. Set a monthly amount you would be genuinely unhappy to exceed.
4. Set alert thresholds at **50%, 90% and 100%** of actual spend, and tick
   **forecasted spend** as well — that is the one that warns you before the money
   is gone rather than after.
5. Add your email under **Manage notifications**.

A budget alert **notifies; it does not cap.** Nothing here stops spending. The
real ceilings are `LEGACY_SYNC_MAX_COST_USD` on the sync and the per-function
limits below.

Also set per-function safety limits, because a runaway function is the realistic
way to spend money by accident. Google Cloud console → **Cloud Functions → the
function → Edit → Runtime**:

| Function                    | Suggested max instances | Why                                                             |
| --------------------------- | ----------------------- | --------------------------------------------------------------- |
| `syncLegacyRecipes`         | 1                       | Two concurrent runs would race the same cursor and double-spend |
| `generateMealPlan`          | 3                       | Each call is a paid Claude request                              |
| `importHelloFreshFromPhoto` | 3                       | Each call is a paid Claude Vision request                       |
| `importInventoryFromCSV`    | 5                       | Firestore writes, not paid API calls                            |

---

## 10. Set up monitoring and alerting

Everything here is in the Google Cloud console under **Monitoring → Alerting →
Create policy**, on the same project. Send every one of them to an email
notification channel you actually read (**Monitoring → Alerting → Notification
channels → Email**).

### 10a. Security rule denials — the one that matters after step 7

- **Metric:** `firestore.googleapis.com/api/request_count`
- **Filter:** `response_code = "PERMISSION_DENIED"`
- **Condition:** rate above ~5/minute, sustained for 5 minutes
- **Why:** for the first days after step 7, this is your early warning that a
  real user is hitting a write shape the rules reject. Later on, a sustained
  spike means something else. Set it _before_ you deploy the rules so you have a
  baseline.

### 10b. Cloud Functions failures

- **Metric:** `cloudfunctions.googleapis.com/function/execution_count`
- **Filter:** `status != "ok"`
- **Condition:** more than 5 failures in 5 minutes, grouped by `function_name`
- **Why:** catches a bad deploy, an expired API key, or a quota wall. Group by
  function name so the alert tells you which one.

### 10c. The daily waste alert not running

`sendDailyWasteAlerts` is the only scheduled job, and its failure mode is
silence — nobody gets an alert and nothing complains.

- **Metric:** `cloudfunctions.googleapis.com/function/execution_count`
- **Filter:** `function_name = "sendDailyWasteAlerts"`
- **Condition:** **absence** of data for 26 hours
- **Why:** an alert on the job _not_ happening. A failure alert cannot fire for a
  run that never started.

### 10d. Function latency

- **Metric:** `cloudfunctions.googleapis.com/function/execution_times`
- **Condition:** 95th percentile above 30s for 10 minutes
- **Why:** `syncLegacyRecipes` has a 540-second timeout and the import functions
  call external APIs. Sustained slowness usually means an upstream service is
  degraded, and it is cheaper to know than to hear about it.

### 10e. Firestore read volume

- **Metric:** `firestore.googleapis.com/document/read_count`
- **Condition:** above whatever is 3× your steady state, over 1 hour
- **Why:** every list in this app is a real-time listener. A subscription that
  fails to clean up is invisible in the UI and shows up only as reads, which is
  also where a surprise bill comes from.

### 10f. Uptime check on the frontend

**Monitoring → Uptime checks → Create uptime check**, HTTPS, against the
deployed hostname, every 5 minutes, alerting after two consecutive failures.

### Also worth turning on

- **Error Reporting** (Google Cloud console → **Error Reporting**) groups Cloud
  Functions exceptions automatically. No configuration needed; add a
  notification for new error types.
- **Firebase Performance Monitoring** for the web app, if you want real-user page
  load and network timings — Firebase console → **Performance**. It needs an SDK
  addition, so it is a code change rather than a console step.
- **Firebase App Check** is the real answer to "someone could call my functions
  directly". It needs reCAPTCHA Enterprise configuration and a client change, so
  it is a project rather than a step, but it is the right next hardening move
  after this runbook.

---

## 11. Deploy the frontend

The build is a static bundle and `public/_redirects` is set up for Netlify's SPA
routing.

```bash
npm ci
npm run build        # with the full REACT_APP_* environment set
```

Confirm before shipping:

- `build/service-worker.js` exists. Without it the PWA registers a service worker
  that 404s, offline support silently does not exist, and nothing else looks
  wrong. The `build` CI job checks this for the same reason.
- The footer shows the version you expect.
- `REACT_APP_USE_EMULATORS` is **not** set in the production environment. If it
  is, the shipped bundle tries to talk to `localhost` and nothing works.

---

## Rolling back

**Rules.** Firebase console → **Firestore Database → Rules → history** keeps
every deployed version and will roll back to one. This is the escape hatch for
step 7: if production rules break something you did not anticipate, roll back,
reproduce it in `firestore/tests/firestore.rules.test.js`, fix it, and deploy
again. Do not "fix" it by loosening a rule in the console — that change exists
nowhere in the repository and will be overwritten by the next deploy.

**Functions.** `firebase functions:delete <name>` removes one; redeploying from
an earlier commit restores a previous version.

**Frontend.** Netlify keeps previous deploys and can promote one instantly. Note
that a rolled-back frontend still meets the new rules, so a rollback there does
not undo step 7.

**Indexes.** Deleting an index is instant and rebuilding is not, so leave them
alone unless one is genuinely wrong.
