# The Alexa skill

Roadmap 7.4. How to build, configure and publish the voice skill that puts
things on MyKitchenHub's shopping list:

> "Alexa, tell My Kitchen Hub to add milk"

None of this has been run for this project — the skill does not exist yet, and
creating it needs an Amazon developer account that a build agent should not
have. The code is deployed and inert until the three environment variables in
[step 4](#4-configure-the-cloud-functions) are set.

- [Read this first: what Alexa will not do](#read-this-first-what-alexa-will-not-do)
- [How it fits together](#how-it-fits-together)
- [1. Create the skill](#1-create-the-skill)
- [2. Upload the interaction model](#2-upload-the-interaction-model)
- [3. Point the skill at the Cloud Function](#3-point-the-skill-at-the-cloud-function)
- [4. Configure the Cloud Functions](#4-configure-the-cloud-functions)
- [5. Set up account linking](#5-set-up-account-linking)
- [6. Test it](#6-test-it)
- [7. Certification](#7-certification)
- [What the skill can be asked](#what-the-skill-can-be-asked)
- [When something is broken](#when-something-is-broken)

---

## Read this first: what Alexa will not do

**This skill cannot read or write Alexa's own shopping list, and no skill can.**

Amazon shut off both ways of doing that on **1 July 2024**: List Skills, and the
List Management REST API (`/v2/householdlists/…`). That is what AnyList, Bring!,
Todoist and the rest used to sync with the list built into Alexa, and it is
gone. Anything you find describing "Lists Read" and "Lists Write" skill
permissions predates the shutdown. IFTTT's Alexa shopping-list trigger went the
same way earlier, on 31 October 2023.

What is left is a skill with its own invocation name, holding its own list —
which is exactly what every surviving shopping-list app moved to. The cost is
the phrasing: **every utterance has to name the skill.** "Alexa, add milk to the
shopping list" will always go to Amazon's list, not this one. "Alexa, tell My
Kitchen Hub to add milk" comes here. There is no way around that, and a
certification reviewer will not grant one.

The other direction is closed too. [Alexa Shopping
Kit](https://developer.amazon.com/en-US/docs/alexa/alexa-shopping/alexa-shopping-actions-for-alexa-skills-api-reference.html)
can add products to a customer's **Amazon retail cart**, and its "add to list"
action reaches the **Amazon Wish List only** — not the Alexa Shopping List. It
also only runs inside a live skill session with a spoken confirmation per item,
so it cannot be a background sync from the app.

---

## How it fits together

```
  "Alexa, tell My Kitchen Hub to add milk"
                 │
                 ▼
      Alexa (signed request)
                 │  POST, with an access token
                 ▼
   alexaSkill  ──►  verifyRequest.js      is this really Amazon?
                 ├─►  accountLinking.js   whose kitchen is this?
                 └─►  shoppingList.js     users/{uid}/shoppingListItems
                                                      │
                                                      ▼
                                          the list on the Meal Plan page
```

Four Cloud Functions, all in `functions/src/alexa/`:

| Function | What it is |
| --- | --- |
| `alexaSkill` | The endpoint Amazon POSTs every utterance to |
| `alexaToken` | The OAuth token endpoint account linking exchanges at |
| `createAlexaAuthCode` | Callable. Mints a one-time code for the signed-in cook |
| `unlinkAlexa` | Callable. Revokes every token, so the skill goes quiet |

And one page in the app: `/link/alexa` (`src/pages/LinkAlexa.jsx`), which is
where Amazon sends people to sign in.

The list itself is `users/{uid}/shoppingListItems` — documented in
[firestore/SCHEMA_DOCUMENTATION.md](../firestore/SCHEMA_DOCUMENTATION.md). The
skill writes through the admin SDK, which bypasses the security rules, so
`shoppingList.js` validates the same shape those rules require.

---

## 1. Create the skill

1. Sign in at [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask).
2. **Create Skill** → name *My Kitchen Hub* → **Custom** model → **Provision
   your own** hosting. Do not choose Alexa-hosted: the backend is already the
   project's Cloud Functions.
3. Choose **Start from scratch**.
4. Note the **Skill ID** (`amzn1.ask.skill.…`) from the skill's page. It becomes
   `ALEXA_SKILL_ID`.

---

## 2. Upload the interaction model

The model lives in this repo, one file per locale:

```
alexa/skill-package/interactionModels/custom/en-GB.json
alexa/skill-package/interactionModels/custom/en-US.json
```

In the console: **Build → Custom → Interaction Model → JSON Editor**, paste the
file for the locale, **Save Model**, then **Build Model**. Repeat for each
locale the skill is published in — a locale with no model fails certification.

With the [ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/quick-start-alexa-skills-kit-command-line-interface.html)
instead: `alexa/skill-package/` is already laid out the way `ask deploy`
expects, including `skill.json`. Replace the two `REPLACE-WITH-…` placeholders in
`skill.json` first.

---

## 3. Point the skill at the Cloud Function

**Build → Endpoint → HTTPS**, and set the default region to:

```
https://us-central1-<your-project-id>.cloudfunctions.net/alexaSkill
```

For the certificate question choose **"My development endpoint is a
sub-domain of a domain that has a wildcard certificate from a certificate
authority"** — which is what `cloudfunctions.net` is.

---

## 4. Configure the Cloud Functions

Three variables, in `functions/.env` locally or as function environment
variables when deployed:

```bash
ALEXA_SKILL_ID=amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ALEXA_CLIENT_ID=mykitchenhub-alexa          # you choose this
ALEXA_CLIENT_SECRET=<48+ random characters> # you choose this too
```

The client id and secret are not issued by Amazon — **this app is the OAuth
provider here**, and you are choosing the credential Amazon will present.

```bash
# a reasonable secret
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

Until both are set, linking is refused with "Alexa account linking is not
configured". That is the correct state for a skill that does not exist yet.

`ALEXA_REDIRECT_URIS` is optional and normally unset — see
[README.md](../README.md#alexa-skill--optional-and-off-until-a-skill-exists).

Then deploy:

```bash
firebase deploy --only functions:alexaSkill,functions:alexaToken,functions:createAlexaAuthCode,functions:unlinkAlexa
```

---

## 5. Set up account linking

**Build → Account Linking**, and switch on *Allow users to link their account*.

| Field | Value |
| --- | --- |
| Auth Code Grant | selected |
| Authorization URI | `https://<your-app-domain>/link/alexa` |
| Access Token URI | `https://us-central1-<project-id>.cloudfunctions.net/alexaToken` |
| Client ID | whatever you set as `ALEXA_CLIENT_ID` |
| Client Secret | whatever you set as `ALEXA_CLIENT_SECRET` |
| Client Authentication Scheme | **HTTP Basic** |
| Scope | leave empty |
| Domain List | your app domain |

At the bottom of that page Amazon lists **Alexa Redirect URLs** — three of them,
one per region. You do not have to configure those anywhere: the code already
allows exactly those three hosts and refuses everything else, because a
redirect URI an attacker can choose is an account takeover.

---

## 6. Test it

**Test → Development**, then in the simulator or on a real device:

```
Alexa, open My Kitchen Hub
```

The first attempt should ask you to link your account — check the Alexa app's
activity feed for the **Link Account** card, follow it, sign in, and you should
land back in Alexa. Then:

```
Alexa, tell My Kitchen Hub to add milk
```

and the item should appear on the shopping list on the **Meal Plan** page.

Locally, the whole thing can be exercised without Amazon — the suites cover
signature verification, the token flow, the list operations and every spoken
response:

```bash
npm --prefix functions test -- src/alexa
```

---

## 7. Certification

Worth knowing before you submit:

- **Every sample utterance must invoke the skill by name.** A reviewer will
  test the example phrases exactly as written in `skill.json`.
- **Account linking has to work from a cold start**, on an account the reviewer
  creates themselves. Fill in the testing instructions field — the manifest in
  this repo already has one.
- **A privacy policy URL is required** because the skill handles personal
  information. Replace the `REPLACE-WITH-APP-DOMAIN` placeholder in
  `skill.json`.
- The skill is set to `distributionMode: PUBLIC` in the manifest. For a skill
  only your own household uses, leave it in development and add the Amazon
  accounts under **Test → Beta Test** instead — no certification needed.

---

## What the skill can be asked

| Say | Intent | What happens |
| --- | --- | --- |
| "tell My Kitchen Hub to add milk" | `AddItemIntent` | Adds a row, `source: "alexa"`. Saying it twice does not make two rows |
| "tell My Kitchen Hub to add 2 kilos of potatoes" | `AddItemIntent` | Quantity and unit are kept |
| "ask My Kitchen Hub what is on my shopping list" | `ReadListIntent` | Reads back the stored rows *and* what this week's meals still need. Stops at ten and says where the rest are |
| "tell My Kitchen Hub to remove milk" | `RemoveItemIntent` | Removes every pending row for it. A row the meal plan owns cannot be removed by voice, and the skill says so rather than pretending |
| "ask My Kitchen Hub for help" | `AMAZON.HelpIntent` | Lists the above |

After adding something the microphone stays open, because nobody adds one
thing.

---

## When something is broken

**"There was a problem with the requested skill's response."** The endpoint
returned a non-200 or something unparseable. Check the function log:

```bash
firebase functions:log --only alexaSkill
```

A rejected request logs `Rejected Alexa request: <reason>` and answers 401. The
reasons are the checks in `verifyRequest.js` — an expired certificate, a stale
timestamp, a signature that does not match, or a skill id that is not ours.

**Every request is rejected as "Request is for another skill."** `ALEXA_SKILL_ID`
does not match the skill actually calling. Copy it again from the console.

**Linking fails immediately.** Check `alexaToken`'s log for
`Alexa token exchange failed: <code>`:

- `invalid_client` — the client id or secret in the console does not match the
  environment. Note that the console stores the secret you typed; re-enter both
  sides if in doubt.
- `invalid_grant` — the code was already used, expired (they last five minutes),
  or came back with a different redirect URI than it was issued for.
- `unsupported_grant_type` — the console is not set to **Auth Code Grant**.

**Linking succeeds but the skill still asks to link.** The access token expired
and the refresh did not happen; check `alexaToken`'s log for a `refresh_token`
grant. Access tokens last an hour and Amazon refreshes them itself.

**The cook wants Alexa to forget them.** `/link/alexa` with no query parameters
is a **Disconnect Alexa** button, which revokes every token they hold. They can
also unlink from the Alexa app, which stops Amazon sending the token at all.
