# MyKitchenHub

A progressive web app for running a household kitchen: what is in the fridge,
what is about to go off, what to cook with it, and what that has been costing.

It is a React single-page app on Firebase — Authentication, Firestore, Cloud
Storage and Cloud Functions — installable to a phone home screen and usable
offline for reading.

| | |
| --- | --- |
| **Using the app** | [docs/USER_GUIDE.md](./docs/USER_GUIDE.md) |
| **Working on the code** | [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) · [CONTRIBUTING.md](./CONTRIBUTING.md) · [TESTING.md](./TESTING.md) |
| **When something is broken** | [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) |
| **Going to production** | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| **First-run data** | [docs/INITIAL_DATA_SETUP.md](./docs/INITIAL_DATA_SETUP.md) |
| **The data contract** | [firestore/SCHEMA_DOCUMENTATION.md](./firestore/SCHEMA_DOCUMENTATION.md) |

---

## What it does

- **Inventory** across as many storage locations as you keep food in, with an
  expiry date worked out per ingredient and per location — chicken gets days in
  the fridge, rice gets years in the pantry.
- **Bulk import** from a spreadsheet, validated row by row before anything is
  written.
- **A shared recipe library** you can search by name, tag or ingredient, with
  the ingredients you already have ticked off.
- **HelloFresh import** from a photo of the recipe card, from a link, or by
  hand — and a delivery log that puts the box's ingredients into your fridge
  and its meals onto your week.
- **Waste alerts**: what is about to go off, what the freezer would save and by
  how many days, and which recipes would use it up tonight.
- **Meal planning** for the week, either by hand or generated around what is
  closest to expiring, with a shopping list that knows what you already have.
- **A dashboard and analytics**: what you buy, what it costs, and where.

[docs/USER_GUIDE.md](./docs/USER_GUIDE.md) walks through each of these.

---

## Running it locally

You need **Node.js 20** — what CI runs and what the deployed Cloud Functions
runtime is. The rules and end-to-end suites also need **Java 21**: the Firebase
emulators are JVM processes.

```bash
git clone https://github.com/elliotmai/mykitchenhub.git
cd mykitchenhub
npm install                     # frontend
npm install --prefix functions  # Cloud Functions
npm install --prefix firestore  # emulators + rules tests
```

Three `package.json` files, three installs. `npm install` at the root does not
reach the other two, and a missing one shows up as `firebase: not found` or a
Cloud Functions suite that will not start.

Then create your environment file:

```bash
cp .env.example .env
```

and fill in the six `REACT_APP_FIREBASE_*` values from the Firebase console
(**Project settings → General → Your apps → SDK setup and configuration**). If
you do not have a Firebase project yet, [firebase-setup-guide.md](./firebase-setup-guide.md)
covers creating one.

```bash
npm start          # http://localhost:3000, against the real project in .env
```

### …without touching the real project

Point the build at the local emulators instead. Nothing you do reaches the
Firebase project, and Analytics stays off:

```bash
npm install --prefix firestore     # provides the firebase CLI
firestore/node_modules/.bin/firebase emulators:start --only auth,firestore,functions,storage
```

and in a second terminal:

```bash
REACT_APP_USE_EMULATORS=true npm start
```

The emulator UI is on <http://localhost:4000>. Ports are set in
[firebase.json](./firebase.json): auth 9099, firestore 8080, functions 5001,
storage 9199.

### Checking your work

```bash
npm run validate        # lint + format + unit tests + production build
npm run test:functions  # Cloud Functions
npm run test:rules      # security rules, against the emulator
npm run test:e2e        # Playwright, real build against real emulators
```

[TESTING.md](./TESTING.md) explains what each suite is for and how to write for
it.

---

## Environment variables

Every credential is read from the environment. None are committed, and
`.github/scripts/check-secrets.mjs` fails CI if one ever is.

### Frontend — `.env`, or the build environment

Create React App only exposes variables prefixed `REACT_APP_`, and it inlines
them into the bundle at build time. **Everything in this table ends up readable
in the shipped JavaScript.** That is expected: the Firebase web API key
identifies the project rather than authorising anything. Firestore security
rules are what protect the data.

| Variable | Required | Without it |
| --- | --- | --- |
| `REACT_APP_FIREBASE_API_KEY` | yes | The app cannot reach Firebase at all; the console logs which values are missing |
| `REACT_APP_FIREBASE_AUTH_DOMAIN` | yes | ” |
| `REACT_APP_FIREBASE_PROJECT_ID` | yes | ” |
| `REACT_APP_FIREBASE_STORAGE_BUCKET` | yes | ” |
| `REACT_APP_FIREBASE_MESSAGING_SENDER_ID` | yes | ” |
| `REACT_APP_FIREBASE_APP_ID` | yes | ” |
| `REACT_APP_FIREBASE_FUNCTIONS_URL` | in practice | Signup falls back to building the profile from the browser instead of calling `onUserCreated`, and HelloFresh photo and link import are switched off — the page says so and offers manual entry |
| `REACT_APP_FIREBASE_MEASUREMENT_ID` | no | Firebase Analytics never starts. Nothing else changes |
| `REACT_APP_USE_EMULATORS` | no | `true` points the app at the local emulators, and suppresses Analytics. Leave it unset for any real build |

### Cloud Functions — `functions/.env`, or Firebase Functions config

`functions/index.js` calls `dotenv.config()`, so a gitignored `functions/.env`
works locally. Deployed, set them as function environment variables; the two
Anthropic paths and the legacy credentials also accept the older
`firebase functions:config:set` style as a fallback.

| Variable | Required for | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | HelloFresh photo import, AI meal plans, legacy sync instructions | Photo import returns `vision-not-configured` and the UI offers link or manual entry. Meal plan generation still builds a week from what is expiring and tells the cook the AI was skipped. The legacy sync tags recipes `needs-instructions` instead of writing them. Nothing fails hard. Also readable as `anthropic.key` in Functions config |
| `SPOONACULAR_API_KEY` | Legacy recipe sync | Instruction lookup is skipped entirely and the sync goes straight to Claude |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5` for legacy-sync instruction writing. If you change it, change `PRICE_PER_MTOK` in `functions/src/recipes/claudeInstructions.js` too, or the sync's cost ceiling is measuring the wrong thing |
| `LEGACY_FIREBASE_SERVICE_ACCOUNT` | Legacy recipe sync | The sync cannot connect to the "Let's Eat" project and fails with a message naming the missing variable. Accepts raw JSON or base64-encoded JSON. Also readable as `legacy.service_account` in Functions config |
| `LEGACY_FIREBASE_PROJECT_ID`, `_CLIENT_EMAIL`, `_PRIVATE_KEY` | Legacy recipe sync | The same credential in three parts. Used only when `LEGACY_FIREBASE_SERVICE_ACCOUNT` is unset |
| `LEGACY_SYNC_MAX_COST_USD` | no | Total spend ceiling across every sync run. Defaults to `10` |
| `SYNC_ADMIN_UIDS` | no | Comma-separated uids allowed to start a sync. **Unset means any signed-in user can start one** — set it before launch |

Credentials are read from `process.env` or Functions config only. The
service-account JSON files in `functions/` are never read by application code;
they are being rotated out of band and must not be used or copied.

### Daily waste alerts by SMS — optional, and currently off

**There is no SMS provider key for this project, and the app is designed to work
without one.** The daily alert always writes an in-app notification, which is
what the Waste Alerts page shows. A text is an extra on top: with no key
configured, `sendDailyWasteAlerts` logs that it skipped the text and carries on.
It never fails, and it never costs the cook their alert.

To switch texting on, see
[docs/INITIAL_DATA_SETUP.md](./docs/INITIAL_DATA_SETUP.md#3-configuring-sms-alerts).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SMS_PROVIDER` | no | `textbelt` | `textbelt` or `zixlow`. An unrecognised name logs a warning and skips the text |
| `TEXTBELT_API_KEY` | to send via Textbelt | — | Textbelt credential |
| `TEXTBELT_API_URL` | no | `https://textbelt.com/text` | Override, e.g. for a sandbox |
| `ZIXLOW_API_KEY` | to send via Zixlow | — | Zixlow credential |
| `ZIXLOW_API_URL` | no | `https://api.zixlow.com/v1/sms/send` | Override, e.g. for a sandbox |
| `ZIXLOW_SENDER_ID` | no | `MyKitchenHub` | Sender name shown on the text |

Each cook still opts in individually under **Settings → Waste Alerts**.

### CI

CI reads the `REACT_APP_FIREBASE_*` set, `ANTHROPIC_API_KEY` and
`SPOONACULAR_API_KEY` from GitHub Actions secrets, and falls back to
placeholders so the build job works on a fork without them. The functions deploy
workflow additionally uses `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_TOKEN`.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Development server on port 3000 |
| `npm run build` | Production build into `build/` |
| `npm run validate` | Lint, format check, unit tests with coverage, production build |
| `npm test` | Unit tests in watch mode |
| `npm run test:ci` | Unit tests once, with coverage, as CI runs them |
| `npm run test:functions` | Cloud Functions tests |
| `npm run test:rules` | Firestore security rules against the emulator (needs Java) |
| `npm run test:e2e` | Builds, starts the emulators, runs Playwright |
| `npm run test:e2e:ui` | The same in Playwright's interactive UI |
| `npm run lint` / `lint:fix` | ESLint over `src/` |
| `npm run format` / `format:check` | Prettier over `src/`, `e2e/` and the root scripts |

---

## Repository layout

```
src/
  components/   one directory per feature area, plus Common/ and Layout/
  hooks/        all Firestore access lives in hooks, never in components
  pages/        one per route; thin, they wire hooks to components
  services/     firebase.js (SDK setup), analytics.js, helloFreshApi.js
  config/       version.js and whatsNew.js — the footer version and changelog
  test-utils/   render helpers, document factories, and the Firebase mocks
functions/
  index.js      exports only; every implementation lives under src/
  src/          csvImport, hellofresh, mealPlan, recipes, wasteAlerts, triggers, data
firestore/
  firestore.rules            the security rules that are actually deployed
  SCHEMA_DOCUMENTATION.md    every document shape, field by field
  tests/                     the rules test suite
e2e/            Playwright specs and the emulator seed
docs/           the guides linked at the top of this file
```

Two rules make the rest of the codebase make sense, and both are explained in
[CONTRIBUTING.md](./CONTRIBUTING.md): shared files are append-only, and
`firestore.rules` plus `SCHEMA_DOCUMENTATION.md` are a contract that the
frontend, the functions and the tests must all agree with.

---

## Deployment

The frontend is a static bundle — `public/_redirects` is set up for Netlify's
SPA routing. Cloud Functions deploy from `main` via
`.github/workflows/deploy-functions.yml` whenever anything under `functions/`
changes.

Going to production for the first time is a sequence of console steps in a
specific order, and one of them — switching Firestore out of test mode — is
irreversible in practice. Follow [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
rather than improvising.
