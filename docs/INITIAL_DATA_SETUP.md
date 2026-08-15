# Initial data setup

Roadmap 10.3. Three one-off jobs for the **repo owner** after
[DEPLOYMENT.md](./DEPLOYMENT.md): bringing the old recipe library across, turning
on text alerts if you ever get a provider, and stocking the first kitchen.

**None of this has been run.** The legacy sync spends real money on every live
batch, and how much of it to spend is your call, not a build agent's.

- [1. The legacy recipe sync](#1-the-legacy-recipe-sync)
- [2. Importing your initial inventory](#2-importing-your-initial-inventory)
- [3. Configuring SMS alerts](#3-configuring-sms-alerts)

---

## 1. The legacy recipe sync

Imports the "Let's Eat" library — roughly 500 recipes — into the shared
`recipes` collection.

Most legacy recipes have a name and a rough ingredient list and **no
instructions**. For each of those the sync tries Spoonacular first (cheap), then
falls back to Claude (costs tokens). Both are paid, which is the entire reason
the thing is built the way it is.

### Before you start

- `LEGACY_FIREBASE_SERVICE_ACCOUNT` set on the functions, using the **rotated**
  key (see the top of [DEPLOYMENT.md](./DEPLOYMENT.md#before-you-start-rotate-the-committed-credentials)).
- `SPOONACULAR_API_KEY` set. Without it the sync skips straight to Claude, which
  costs several times more per recipe.
- `ANTHROPIC_API_KEY` set. Without it, recipes still import — they are just
  tagged `needs-instructions` instead of getting any.
- `SYNC_ADMIN_UIDS` set to your uid. Unset, any signed-in user can start a paid
  run.
- A billing budget with alerts ([step 9](./DEPLOYMENT.md#9-set-a-billing-budget)).

### What it costs

The sync tracks its own spend and stores the running total in
`syncMetadata/legacy-recipe-sync`. These are the numbers behind that.

| | Per recipe | Where it comes from |
| --- | --- | --- |
| Already has instructions | **$0.00** | Short-circuits before any paid call |
| Spoonacular lookup | **$0.005** | `DEFAULT_COST_PER_CALL` in `functions/src/recipes/spoonacular.js` |
| Claude instructions | **~$0.008 typical, $0.02 assumed** | Billed from the tokens the response reports, at `PRICE_PER_MTOK` in `claudeInstructions.js` — $5/Mtok in, $25/Mtok out for `claude-opus-5` |

A recipe with no instructions costs one Spoonacular lookup, plus a Claude call
only if Spoonacular found nothing.

**Realistic total for all 500:** somewhere around **$4–7**. Spoonacular is
charged on every lookup ($2.50 for 500), and Claude on whatever it fails to
match — at a 60% Spoonacular match rate that is 200 generations for about $1.60.

**The number the guard uses is higher.** Before each Claude call the sync checks
`spent + $0.02 <= ceiling`, using a deliberately pessimistic per-call estimate so
it stops early rather than overshooting. Measured against that estimate, 500
unmatched recipes would be $12.50 — which is why the default
`LEGACY_SYNC_MAX_COST_USD` of **$10** may stop the run before it finishes. That
is the ceiling working, not a failure; see [resuming](#resuming-a-run-that-stopped).

One caveat on the Spoonacular figure: Spoonacular bills in **quota points**, not
dollars. The $0.005 is a conservative dollar stand-in so the budget guard has
something to count. Your real constraint may be the daily quota on your plan
rather than the money — if lookups start failing mid-run, check your quota before
assuming a bug. A failed lookup is not fatal: the sync counts the cost, falls
back to Claude, and carries on.

### Where to run it

**Recipes → Legacy Sync**, signed in as a uid in `SYNC_ADMIN_UIDS`. The dashboard
shows status, how many recipes have been seen, processed, imported and skipped,
how many instructions came from each source, the running cost, and the last
error.

### Step 1: a dry run

Set **Recipes this batch** to 50, tick **Dry run (spends nothing)**, press **Run
batch**.

A dry run reads the legacy database and reports what it *would* import. It makes
no Spoonacular call, no Claude call and no write, so it costs nothing and it does
not move the cursor forward for the real run.

Read the result carefully — this is your estimate:

- **`imported`** is how many it would bring in.
- **`skipped`** is how many are already here or unusable.
- Every entry with **`instructionSource: 'none'`** is a recipe that will need
  paid lookups in a live run. That count, times $0.005 plus at most $0.02, is
  what the first real batch will cost.

If the dry run errors, fix that before spending anything. A credentials problem
names the missing variable and nothing else — it never echoes a value.

### Step 2: a 50-recipe trial

Untick **Dry run**, leave the batch at **50**, press **Run batch**.

Expect roughly **$0.30–$0.70**, and at most about $1.25 if every recipe needs
both a lookup and a generation.

Then stop and check, before running anything larger:

1. **The cost line on the dashboard.** Is it what you estimated? If it is much
   higher, the Spoonacular match rate is worse than expected and the full run
   will cost proportionally more.
2. **The recipes themselves.** Open a handful in the library. Do the ingredients
   look right? Are the Claude-written instructions actually usable? They carry
   the tag `ai-instructions`; Spoonacular's carry `spoonacular-instructions`;
   neither carries `needs-instructions`.
3. **The status.** `in-progress` means there is more to do. `completed` means the
   library is shorter than you thought. `cost-limit-reached` means you hit the
   ceiling on the first batch, which means the estimate was badly off.

If the recipes are wrong, stop now — you have spent under a dollar finding out.

### Step 3: the rest

Keep pressing **Run batch**. Each press processes one batch and stops.

Use **25 to 50 per batch**. The function has a 540-second timeout, and each
Claude generation takes a second or two, so the 100 hard cap can time out on a
batch where nothing matched in Spoonacular. A timed-out batch is not a
catastrophe — the cursor only advances on a completed batch — but you pay for
work you do not keep.

Watch the running cost between batches. Ten batches of 50 is ten decisions to
continue, which is the point.

### Monitoring it

- **The dashboard** after each batch: cost, counts, instruction sources, last
  error.
- **Cloud Functions logs** — Google Cloud console → **Logging → Logs Explorer**,
  filter `resource.labels.function_name="syncLegacyRecipes"`. Failures are logged
  by message, never with a credential.
- **`syncMetadata/legacy-recipe-sync`** in Firebase console → Firestore is the
  source of truth: `costAccumulated`, `cursor`, `currentStatus`, `lastError`,
  `recipesImported`, `instructionSources`.
- **Your billing budget** alert, which is the backstop for all of the above.

### Resuming a run that stopped

Progress and a resume cursor live in `syncMetadata/legacy-recipe-sync`, so the
next batch picks up where the last one stopped. **Pressing Run batch again is the
resume.** There is no separate resume action, and re-running does not re-import:
anything already brought across is detected by its `legacyId` and skipped.

| Status | What happened | What to do |
| --- | --- | --- |
| `in-progress` | The batch finished, more remain | Press **Run batch** |
| `completed` | The library has been walked end to end | Nothing. You are done |
| `cost-limit-reached` | Spend hit `LEGACY_SYNC_MAX_COST_USD` | Decide whether to spend more. To continue, raise `LEGACY_SYNC_MAX_COST_USD` on the function and redeploy, then **Run batch**. The ceiling is checked against the *lifetime* total, not per run |
| `error` | Something threw; `lastError` says what | Fix it, then **Run batch**. The cursor did not move past the failure |
| `disabled` | `enabled` is `false` on the metadata document | Deliberate. See below |
| A batch timed out | No status written | Press **Run batch** and use a smaller batch size |

**"Start over" rewinds the cursor to the first recipe.** It does not delete
anything, so a restarted run re-reads recipes it already imported and skips them
— slow, and each skip is free. Use it only when you believe the cursor is wrong.

### Stopping it for good

Set `enabled: false` on `syncMetadata/legacy-recipe-sync` and live runs are
refused with a `disabled` status. Dry runs still work.

You have to do this from the Firebase console — Firestore Database →
`syncMetadata` → `legacy-recipe-sync` → edit `enabled` — because the security
rules make `syncMetadata` unwritable from any client. Console edits are made as
an administrator and bypass rules.

---

## 2. Importing your initial inventory

Stocking a kitchen by hand is the slowest possible start. Import a spreadsheet
instead.

### Through the app

**Inventory → Import CSV**. The file is parsed and validated **in the browser**,
and you see exactly which rows will import and what is wrong with the rest —
with a line number and a reason for each — before anything is written. Good rows
are then written in batches of 500, which is Firestore's per-batch limit, and the
run is logged to `users/{uid}/importHistory`.

The column reference is in
[USER_GUIDE.md](./USER_GUIDE.md#importing-a-spreadsheet). Briefly: `name`,
`quantity` and `location` are required; `unit`, `notes`, `shelfLifeDays`,
`expiresAt`, `price` and `store` are optional; headings are matched
case-insensitively and accept common synonyms; unrecognised columns are ignored.

Two things worth doing on a first import, because they are much more annoying to
add later:

- **Put in `price` and `store`.** The whole Analytics page is built from them,
  and it has nothing to show until they exist.
- **Leave `expiresAt` and `shelfLifeDays` out** unless you have a real reason.
  The app looks each ingredient up against the location you are putting it in and
  works out a better date than a spreadsheet column will. Setting `shelfLifeDays`
  marks the item as having a shelf life *you* chose, and the app will then stop
  recalculating it — including when you move the item to the freezer, which is
  usually the one time you want it recalculated.

Files over 5,000 rows are refused. Split them; each part is logged separately.

### From a script

The same import runs server-side as the `importInventoryFromCSV` HTTP function —
useful for a file large enough that you would rather not keep a browser tab open:

```bash
curl -X POST "$FUNCTIONS_URL/importInventoryFromCSV" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -d @- <<'JSON'
{
  "fileName": "kitchen.csv",
  "csvData": "name,quantity,location\nMilk,1,Main Fridge\nRice,5,Pantry"
}
JSON
```

With an `Authorization: Bearer <Firebase ID token>` header the import runs
against the token's own account and ignores any `userId` in the body. It needs no
new environment variables and costs nothing beyond Firestore writes.

Start with three rows and confirm they landed before sending a real file.

---

## 3. Configuring SMS alerts

**There is no SMS provider key for this project, and nothing is waiting on one.**
The daily waste alert always writes an in-app notification, which is what the
Waste Alerts page shows. With no key configured, `sendDailyWasteAlerts` logs that
it skipped the text and carries on — it never fails, and it never costs anyone
their alert.

This section is what to do **if** you get a provider. Until then, skip it.

### Choosing one

Two adapters ship, in `functions/src/wasteAlerts/smsClient.js`:

| Provider | `SMS_PROVIDER` | Key variable | Default endpoint |
| --- | --- | --- | --- |
| Textbelt | `textbelt` (the default) | `TEXTBELT_API_KEY` | `https://textbelt.com/text` |
| Zixlow | `zixlow` | `ZIXLOW_API_KEY` | `https://api.zixlow.com/v1/sms/send` |

An `SMS_PROVIDER` the app does not recognise logs a warning and skips the text.
It does not fail, and it does not fall through to the other provider.

Adding a third means adding an adapter to the `PROVIDERS` map in that file — an
entry with a key variable, a URL, a request body builder, and how to read success
out of the response. Do not add provider branching at the call site.

### Turning it on

1. Get a key from the provider.
2. Set it on the deployed functions. Google Cloud console → **Cloud Functions →
   `sendDailyWasteAlerts` → Edit → Runtime, build … → Runtime environment
   variables**:

   ```
   SMS_PROVIDER=textbelt
   TEXTBELT_API_KEY=<the key>
   ```

   Locally, the same names in a gitignored `functions/.env`.
3. **Test against a sandbox first.** Both adapters honour a URL override —
   `TEXTBELT_API_URL` or `ZIXLOW_API_URL` — so point one at your provider's test
   endpoint and confirm the request shape before a real message reaches a real
   phone. If your provider offers a test key that reports success without
   sending, use that for the first run.
4. Redeploy the function.
5. Each cook opts in individually under **Settings → Waste Alerts**, which sets
   `preferences.smsAlerts.enabled` and stores the number to text. **A key alone
   sends nothing** — nobody is opted in by default, which is intentional.
6. Wait for the 9 AM Eastern run, or check the logs after it.

### Confirming it worked

Every alert records how it actually reached the cook. In
`users/{uid}/notifications/waste-alert-<YYYY-MM-DD>`:

- `channel` is `sms` when a text went out, `in-app` otherwise.
- `smsStatus` is `sent`, or the reason it was not: `not-configured` (no key),
  `no-phone-number` (opted in without a number), `not-requested` (not opted in),
  `rejected` (the provider refused it), `request-failed` (the request never
  landed), `unknown-provider` (`SMS_PROVIDER` is a name the app does not know).

The function's own log line summarises each run: users alerted, notifications
written, texts sent, texts skipped, errors.

If `smsStatus` stays `not-configured` after you set the key, the function is
running with the old environment — redeploy.

### Costs

Texting is per message. One message per opted-in cook per day, and only on days
something is actually expiring. Fold it into the billing budget from
[step 9](./DEPLOYMENT.md#9-set-a-billing-budget) before turning it on, and be
aware that the app does not cap SMS spend the way it caps the legacy sync.
