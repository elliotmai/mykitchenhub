# The `board` API (Fridge Board)

A small, token-protected HTTP API over **one** cook's kitchen, for
[Fridge Board](#who-calls-it) — a kitchen kiosk that calls it server to server
from a Netlify function. It returns this week's meals, the recipes for them as
step-by-step cards, the shopping list exactly as KitchenHub shows it, and the
food about to go off; it can add a shopping item and tick one off.

| | |
| --- | --- |
| **Function** | `board` — 1st gen HTTPS, default region `us-central1`, same as every other HTTP function here |
| **URL** | `https://us-central1-mykitchenhub-db665.cloudfunctions.net/board` |
| **Code** | `functions/src/board/` (`board.js` is the entry point) |
| **Token script** | `functions/scripts/make-api-token.mjs` |

It uses the Firebase Admin SDK, so **Firestore security rules do not apply**.
Every read and write is scoped in code to the one user the token belongs to;
the only data outside `users/{thatUid}` it touches is reading the shared
`recipes` library. Nothing in a request can name another user.

There are no CORS headers on purpose: nothing calls this from a browser, and a
token that never sits in a web page cannot leak from one.

---

## Setting up a token

1. Generate one:

   ```bash
   node functions/scripts/make-api-token.mjs
   ```

   It prints a random token (32 bytes, base64url) and its SHA-256 hash. The
   token is shown once and stored nowhere — put it straight into the Fridge
   Board Netlify environment (or a password manager).

2. Firebase console → **Firestore Database → `users` → your user id**. Add the
   **hash** (never the token) to the array field `apiTokenHashes` — create the
   field as an *array* if it is not there. One entry per connected app, so each
   can be revoked on its own. A single string field `apiTokenHash` also works.

3. Optional: add a string field `timezone` with an IANA name such as
   `America/Chicago`. It decides what "today" means for the meals, the expiry
   countdown and today's cart. Without it — or with a name the runtime does not
   recognise — the API uses `America/Chicago`.

**To revoke**, delete the array entry (or the field). It takes effect on the
next request.

The app cannot write these fields: `firestore.rules` refuses any client create
or update that adds, changes or removes `apiTokenHash` / `apiTokenHashes`, so a
borrowed browser session cannot mint itself standing API access. Only the
console or the admin SDK can grant or revoke a token. If the same hash ends up
on two user documents, the API refuses it rather than guess which kitchen was
meant.

## Deploying

```bash
cd functions && npm ci
firebase deploy --only functions:board --project mykitchenhub-db665
```

A push to `main` touching `functions/**` also deploys every function
automatically (`.github/workflows/deploy-functions.yml`). The rules change that
protects the token fields deploys separately, with the **Deploy Firestore rules
and indexes** workflow button or `firebase deploy --only firestore:rules`.

---

## Requests

Every request carries `Authorization: Bearer <token>`. Bodies are JSON
(`Content-Type: application/json`). Every error is JSON `{ "error": "…" }`:

| Status | Meaning |
| --- | --- |
| 400 | The body is wrong, or the line cannot be ticked (see below) |
| 401 | No token, a malformed or short one, an unknown one, or one on two users |
| 404 | Unknown route, or an unknown shopping item id |
| 500 | Something failed inside; the detail is in the function logs, never the response |

Authentication happens before routing, so an unauthenticated caller gets 401
for every path.

### `GET /` — the board

```json
{
  "today": "2026-11-17",
  "meals": [
    { "date": "2026-11-17", "type": "Dinner", "name": "Chili", "recipeId": "r-chili", "status": "planned" }
  ],
  "recipes": {
    "r-chili": {
      "name": "Chili",
      "sub": null,
      "time": "1 hr",
      "serves": 4,
      "cal": null,
      "ingredients": ["1 lb lean ground beef"],
      "steps": [
        { "title": "Step 1", "text": ["Brown the beef."], "uses": [] },
        { "title": "Step 2", "text": ["Add the beans and simmer for 45 minutes."], "uses": [], "timer": 45 }
      ]
    }
  },
  "expiring": [{ "name": "Spinach", "days": 0 }],
  "shopping": [
    { "id": "meal:ground beef|lb", "name": "ground beef", "qty": "1 lb", "section": "Meat & Seafood", "why": "Chili", "bought": false },
    { "id": "item:3fK9…", "name": "Batteries", "qty": "4 pack", "section": "Other", "why": null, "bought": false }
  ]
}
```

- **`today`** — the date on the cook's clock (see `timezone` above).
- **`meals`** — `users/{uid}/mealPlanEntries` dated today through today + 6,
  ordered by date and then breakfast, lunch, dinner, snack. `type` is the
  stored `mealType` capitalised, `name` is the entry's `recipeName`, `recipeId`
  is null for a free-text meal. Cooked and skipped meals are included with
  their status.
- **`recipes`** — one card per `recipes/{id}` those meals reference. A meal
  whose recipe has been deleted keeps its `recipeId` but has no card. How a
  card is read off the stored recipe:

  | Card field | From |
  | --- | --- |
  | `name` | `name` (the meal's `recipeName` if the recipe has none) |
  | `sub` | first line of `description` (Markdown and pasted imports), else null |
  | `time` | `prepTime + cookTime`, as the recipe page shows it: `"35 min"`, `"1 hr 10 min"`; null when neither is recorded |
  | `serves` | `servings` |
  | `cal` | `nutrition.calories` (`"780 kcal"` → 780) or a numeric `calories`; null when absent |
  | `ingredients` | each ingredient's printed `text` when the importer kept it, else `quantity unit name` — `"10 oz ground beef"`, `"1/2 lime"` |
  | `steps` | `instructions` — see below |

  KitchenHub stores `instructions` as an array of plain strings, one per step
  (older legacy imports: one blob of text). Each becomes a card:
  - **`title`** — the importer's `"Heading: step"` prefix when there is one
    (a short phrase of up to five words, no digits), else `"Step N"`.
  - **`text`** — the step's lines as paragraphs, with any `"Step 3:"` / `"3."`
    numbering the source wrote removed.
  - **`uses`** — always `[]` today: no writer stores which ingredients a step
    uses.
  - **`timer`** — minutes, when the step states a duration: `"15 minutes"` →
    15, `"10–12 min"` → 10 (the lower bound), `"1 hour"` → 60. Omitted when the
    step names none. Seconds are ignored.
  - A blob is split on its own numbering (`"1. … 2. …"`), else on line breaks,
    else — one long paragraph — into pairs of sentences.
  - The importer's "No steps were saved…" placeholder is dropped.
- **`expiring`** — inventory with an expiry within five days, soonest first,
  exactly the set the Waste Alerts page and KitchenHub's own kiosk show.
  `days` is whole calendar days in the cook's timezone: 0 is today, and food
  already past its date is included with a **negative** number, as it is in
  the app.
- **`shopping`** — what KitchenHub's kiosk shows as still to buy: the typed
  items (`users/{uid}/shoppingItems`, status `pending`) combined with the lines
  the week's meals need that the kitchen does not cover, by the same
  `buildShoppingList` / `combineShoppingList` the app runs. As in the app:
  - The week is the **Monday-to-Sunday week containing today** — the week the
    meal plan page opens on — not the seven rolling days `meals` covers. A
    planned meal earlier this week still counts; next Monday's does not yet.
  - The same food in two units is two lines; it is never summed.
  - A typed item and a derived line with the same name are one errand: the
    typed row wins.
  - `section` is the aisle (`src/config/storeSections.js`), and the list is in
    aisle order: Produce, Bakery, Meat & Seafood, Dairy & Eggs, Frozen, Pantry,
    Drinks, Other.
  - `why` is the recipe name(s) a derived line is for (`"Chili"`,
    `"Pasta, Soup"`); null for typed items.
  - `qty` is the app's amount label: `"1 lb"`, `"4 pack"`, or `""` for one of
    something unmeasured.
  - After the outstanding lines come typed items **ticked off today** (by
    `boughtAt`, in the cook's timezone) with `bought: true`, so the kiosk can
    show the cart.

  Ids: `item:<shoppingItems doc id>` for a typed item;
  `meal:<normalized name>` or `meal:<normalized name>|<unit>` for a derived
  line. URL-encode an id when it goes into a path.

### `POST /shopping` — add an item

```json
{ "name": "Oat milk", "section": "Dairy & Eggs" }
```

Creates a `shoppingItems` document exactly as the app's add box does: name
trimmed, `normalized` lowercased, quantity 1, empty unit and notes, status
`pending`, source `manual`, `boughtAt` null, `createdAt` the server time.
`name` is required, non-blank, at most 200 characters.

`section` is accepted and **ignored**. KitchenHub files every line by its name
and stores no aisle, so a stored section would be one the app never shows. The
response says where the item actually went:

```json
{ "item": { "id": "item:3fK9…", "name": "Oat milk", "qty": "", "section": "Dairy & Eggs", "why": null, "bought": false } }
```

### `POST /shopping/{id}` — tick off, or put back

```json
{ "bought": true }
```

- **`item:…`** — does what the row's checkbox does in the app: `bought: true`
  sets `status: "bought"` and stamps `boughtAt`; `false` sets it back to
  `pending` and clears `boughtAt`. Returns `{ "ok": true }`. 404 if there is
  no such item for this cook.
- **`meal:…`** — **refused with 400.** A line derived from the meal plan has no
  checkbox in KitchenHub and no document behind it (see
  `firestore/SCHEMA_DOCUMENTATION.md` §8, "Derived rows are not tickable at
  all"); it leaves the list when the kitchen's inventory covers it or the meal
  plan changes. The API mirrors that rather than inventing a write the app
  never makes. An id that is not on the current list is a 404.

`bought` must be a boolean, or the request is a 400.

---

## Who calls it

Fridge Board's Netlify function, with the token in its environment. Keep the
token server-side: it grants read access to the whole kitchen and write access
to the shopping list.
