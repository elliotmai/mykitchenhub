# Working agreement

Several sessions build different roadmap sections of this app in parallel, each
on its own branch, merged into `main` by a coordinating session. These are the
rules that keep that from turning into a merge disaster.

Read [TESTING.md](./TESTING.md) before writing code.

---

## 1. Stay inside your section

Own your feature's directories outright. Create files freely under:

- `src/components/<YourFeature>/`
- `src/pages/<YourPage>.jsx`
- `src/hooks/use<YourThing>.js`
- `functions/src/<yourFeature>/`

**Shared files are append-only.** These are edited by every section, so make the
smallest possible additive change and never reformat or reorder them:

| File | Your change should be |
| --- | --- |
| `src/App.jsx` | Nothing — all seven routes already exist |
| `src/pages/index.js` | One export line, if you add a page |
| `src/hooks/index.js` | One export line per hook |
| `src/components/*/index.js` | One export line per component |
| `functions/index.js` | One `exports.x = ...` line; the implementation lives in `functions/src/` |
| `package.json` | Dependencies only (plus your version bump) |

If you find yourself needing to restructure a shared file, stop and ask — that's
a coordination decision, not an implementation one.

## 2. The data model is a contract, not a suggestion

`firestore/SCHEMA_DOCUMENTATION.md` and `firestore/firestore.rules` define every
document shape. The frontend, the Cloud Functions, and the security rules must
agree — three separate places where drift has already caused real bugs
(storage locations keyed on `name` instead of `label`; inventory items written
with `addedBy` instead of `source`).

Before writing a document from any layer, check the required fields in
`firestore.rules`. If you need a new field or collection:

1. Update `firestore/firestore.rules`.
2. Update `firestore/SCHEMA_DOCUMENTATION.md`.
3. Add or update a case in `firestore/tests/firestore.rules.test.js`.
4. Update the matching factory in `src/test-utils/factories.js`.

All four, in the same commit. The rules tests are what catch drift — Firestore
is still in test mode, so a violating write succeeds today and breaks the moment
step 10.2 turns production rules on.

## 3. Secrets and external services

Available as GitHub Actions secrets: `ANTHROPIC_API_KEY`, `SPOONACULAR_API_KEY`,
and the `REACT_APP_FIREBASE_*` / `FIREBASE_*` set.

**There is no SMS provider key.** Anything needing SMS (Textbelt/Zixlow) must
read its credential from an environment variable, degrade gracefully when it's
absent, and fall back to in-app notification. Never make a missing SMS key a
hard failure.

Rules for all external services:

- Read every credential from `process.env` or Firebase Functions config. Never
  hardcode one, never log one, never commit one.
- Document any new environment variable in `README.md`.
- **Tests must never call a real external API.** Mock the HTTP client. A test
  suite that costs money or needs the network is a broken test suite.
- Don't run expensive one-off operations (the full 500-recipe legacy sync, bulk
  Claude Vision calls). Build them, test them against mocks, and leave running
  them to the repo owner.

`functions/service-account.json` and
`functions/legacy-firebase-service-account.json` contain live credentials that
the owner is rotating separately. **Do not read, move, modify, or delete them.**

## 4. Every change ships with tests

CI runs seven jobs and all must pass. Locally, `npm run validate` covers the
fast ones.

- New hook or component → unit tests
- New Cloud Function → tests in `functions/src/<feature>/__tests__/`
- New document shape or rules change → cases in the rules test suite
- New user-facing flow → an end-to-end spec

Coverage thresholds in `package.json` are a ratchet. Raise the floor when your
tests push coverage up. **Never lower a threshold to make a build pass** — if
coverage dropped, write the missing test.

## 5. Version and changelog

The footer version tracks the roadmap: `0.<phase>.<step>`. When you finish the
last roadmap step in your section:

1. Set `APP_VERSION`, `ROADMAP_STEP`, `ROADMAP_STEP_NAME` in
   `src/config/version.js`.
2. Set `version` in `package.json` to the same value.
3. Add a `src/config/whatsNew.js` entry, newest first, dated today
   (`YYYY.MM.DD`, or `YYYY.MM.DD.N` for a second release the same day). Write it
   for a person cooking dinner, not for a developer: what changed for *them*.

Both a test and a CI workflow enforce this. If a change genuinely isn't
user-visible, put `[whats-new: none]` in the commit message instead.

## 6. Branches

Work on your assigned branch. Commit in logical chunks with clear messages.
Push with `git push -u origin <your-branch>`.

**Do not merge to `main`, do not open pull requests, and do not touch another
section's branch.** The coordinating session merges and resolves conflicts.

Rebase on `main` before your final push so you land on current code:

```bash
git fetch origin main && git rebase origin/main
npm run validate
git push -u origin <your-branch>
```

## 7. When you're blocked

Blocked means: a *product* decision you can't make from the roadmap, the spec,
or the code — not a technical problem you could solve by reading more.

Technical unknowns are yours to resolve. Ambiguity about what the user wants,
where a judgement call would be expensive to undo, is theirs.

If you are genuinely blocked:

1. Finish and push everything that does **not** depend on the answer.
2. Rename your session title to `BLOCKED: <your one-line question>`.
3. Stop and wait. Don't guess at a product decision and build on the guess.

State the question so it can be answered from a phone in one line: give the
options and your recommendation, not an essay.
