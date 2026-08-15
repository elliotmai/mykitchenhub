# MyKitchenHub — user guide

Everything the app does, in the order you are likely to need it.

- [Getting started](#getting-started)
- [Storage locations](#storage-locations)
- [Inventory](#inventory)
- [Importing a spreadsheet](#importing-a-spreadsheet)
- [Recipes](#recipes)
- [HelloFresh](#hellofresh)
- [Waste alerts and the freezer rescue](#waste-alerts-and-the-freezer-rescue)
- [Meal planning](#meal-planning)
- [The dashboard](#the-dashboard)
- [Analytics](#analytics)
- [Settings](#settings)
- [Installing it on your phone](#installing-it-on-your-phone)

---

## Getting started

Sign up with an email address and a password of at least six characters. The
account is created and, with it, four storage locations to put food in — Main
Fridge, Freezer, Pantry and Counter — so you can start adding things
immediately. If you forget the password later, **Forgot your password?** on the
sign-in screen emails you a reset link.

Everything you see is yours alone. The one exception is the recipe library,
which is shared: recipes anyone adds are visible to everyone signed in.

---

## Storage locations

A location is somewhere you keep food. **Settings → Storage Locations** lists
them and lets you add more — a garage fridge, a chest freezer, a spice shelf.

Each location has a **type**: `fridge`, `freezer` or `pantry`. The type is what
the app uses to work out how long things keep, so a "Beer Fridge" should be
typed `fridge` even if what is in it never goes off. The label, icon and colour
are yours to change at any time; **the type cannot be changed after the location
is created** — make a new one and move the items instead.

The four locations you started with are marked as defaults and cannot be
deleted. Any location you add yourself can be, but only once it is empty: the
app refuses to delete a location that still has items in it and tells you how
many, so nothing disappears silently.

---

## Inventory

**Inventory** is the list of what you actually have.

### Adding something

**Add Item** asks for a name, a quantity and a unit, and where it lives. It will
also take a price and a shop, which is what later fills in the Analytics page —
worth typing if you want that page to be useful, and safe to skip if you don't.

You do not have to work out an expiry date. The app looks the ingredient up
against the location you are putting it in — chicken breast in the fridge gets a
couple of days, the same chicken in the freezer gets months, rice in the pantry
gets years — and sets the date from that. If it doesn't recognise the
ingredient, it falls back to a sensible default for that kind of storage.

If you would rather set the shelf life yourself, type a number of days. Once you
have done that, **it is yours**: the app stops recalculating that item, and
keeps your number even when you move the item somewhere else.

### Finding something

The list has a tab per location with a count on it, a search box that matches
the item name, its notes and its location, and a filter for how soon things go
off:

| Filter | Means |
| --- | --- |
| 🔴 Expired | Already past its date |
| 🟠 ≤ 2 days | Today or the next two days |
| 🟡 ≤ 5 days | Within five days |
| 🟢 Fresh | Everything else |

Whatever you filter by, the list is sorted with the most urgent first.

### Colours

Every item card is colour-coded on the same scale the rest of the app uses:
red for expired or within two days, amber within five, plain after that. It is
the same scale on the dashboard and the waste alerts page, so "red" means the
same thing everywhere.

### Changing and removing

Edit an item to change any of it, including moving it to another location —
which recalculates the expiry date unless you set the shelf life by hand.
Deleting asks for confirmation first, and cannot be undone.

---

## Importing a spreadsheet

Stocking the app one item at a time is slow. **Inventory → Import CSV** takes a
whole spreadsheet.

The file is read **in your browser** and checked before anything is saved. You
get a preview of exactly which rows will be added and which will not, with the
line number and the reason for each rejection, and nothing is written until you
say so.

### The columns

The first line names the columns. Names are matched case-insensitively and
common alternatives are accepted (`Item` or `Product` for `name`, `Qty` or
`Amount` for `quantity`). Columns the app doesn't recognise are ignored, so you
can import a spreadsheet you keep for other reasons.

| Column | Required | Notes |
| --- | --- | --- |
| `name` | yes | Trimmed to 80 characters |
| `quantity` | yes | Must be greater than 0. `1,200` is read as 1200 |
| `location` | yes | One of your own labels ("Main Fridge"), or just a type ("fridge", "freezer", "pantry") |
| `unit` | no | Free text — `lbs`, `gal`, `bags` |
| `notes` | no | Trimmed to 200 characters |
| `shelfLifeDays` | no | A positive number of days, up to 3650 |
| `expiresAt` | no | Any date your browser can read. Without it the expiry is worked out from shelf life. A plain `2027-01-15` means that calendar day where you are, not midnight UTC |
| `price`, `store` | no | Recorded as a purchase, which is what feeds Analytics |

```csv
name,quantity,unit,location,notes
Whole Milk,1,gal,Main Fridge,
Chicken Breast,2,lbs,Freezer,From Costco
Basmati Rice,5,lbs,Pantry,
```

Files of more than 5,000 rows are refused — split them.

Every import is logged. The importer shows your five most recent runs, so you
can look back and see what a particular file actually added.

---

## Recipes

**Recipes** is one library shared by everyone using the app.

Search it by name, by tag, or by an ingredient — the search box looks at all
three, so typing "salmon" finds recipes called salmon and recipes that use it.
You can also filter by tag, by source, by difficulty and by total time, and sort
by newest, A–Z, most cooked, or quickest.

### Reading one

Open a recipe and the ingredients you already have are ticked off against your
inventory, so you can see what you would need to buy before you start.

**"I cooked this"** bumps a counter, which is what lets you sort by what is
actually in your rotation.

### Adding your own

**Add Recipe** takes ingredients with autocomplete drawn from your own kitchen,
instructions built one step at a time so you can reorder them without retyping,
tags, servings, difficulty, timings and a photo. Name, at least one ingredient,
at least one instruction and a serving count above zero are required; everything
else is optional.

### Editing and deleting

Anyone can fix a typo or correct the steps on any recipe — it is a shared
library. Two things are fixed once a recipe exists: **its name and the date it
was added**. The edit form disables the name field for that reason.

**You can only delete recipes that were added by hand in this app.** Anything
imported — from the old "Let's Eat" library, from Spoonacular, from HelloFresh —
stays. Deleting removes the recipe for everyone, so it asks first.

---

## HelloFresh

The **HelloFresh** page does two separate things: gets a recipe into your
library, and records the box it came in.

### Getting a recipe in

Three tabs, in order of least typing:

- **Photo** — photograph the recipe card and the app reads the ingredients and
  steps off it.
- **Link** — paste a HelloFresh recipe link and it fills itself in.
- **By hand** — start a blank recipe and type it.

Photo and link both hand you a **review form** before anything is saved. Check
it — the ingredients in particular — then save. Anything the import was unsure
about is flagged on the form rather than saved quietly.

If this build has no Cloud Functions configured, the page says so at the top and
photo and link import are switched off. Adding recipes by hand still works.

### Logging a delivery

**Add delivery** records a box: when it arrived, which recipes were in it, how
many meals, and which storage location the ingredients should go to.

Logging it does three things at once:

1. Every ingredient from those recipes goes into your inventory, in the location
   you chose, each with its own expiry date.
2. The box's meals are scheduled onto your **Meal Plan** — the first on delivery
   day, then every other day after that — so you are not cooking three dinners
   on a Monday.
3. The delivery is added to your **delivery history**, with what came in it and
   how many items it added.

Removing a delivery from the history removes only the record. Ingredients
already in your kitchen and meals already on your plan stay where they are.

---

## Waste alerts and the freezer rescue

**Waste Alerts** answers one question: what am I about to throw away, and what
can I do about it tonight?

It shows everything expiring within five days, worst first, split into expired,
critical and soon. Alongside it are two ways out.

### The freezer

The app works out which of those items the freezer would actually save, and by
how many days. It only suggests things worth suggesting — it will not offer to
freeze the lettuce, because the shelf-life table knows lettuce does not freeze,
and it will not bother you about something that would only gain a couple of
days. The list is ordered by how much time freezing buys.

- **Freeze all** moves the whole item to your freezer and recalculates the
  expiry date from scratch — which is the entire point.
- **Freeze half** splits it: half goes to the freezer, the rest stays where it
  is. Useful for chicken you want tonight and chicken you want next month. It
  needs at least two of something to split.

The frozen half is created before the original is reduced, so if anything goes
wrong you still have all your food rather than half of it.

### Recipes

The page also suggests recipes that use what is about to expire, and **Add to
Meal Plan** puts one straight onto your week.

### The daily alert

Once a day at 9 AM Eastern the app checks what is about to go off and writes you
an in-app alert. It appears at the top of the Waste Alerts page, where you can
mark it read or dismiss it. Re-running on the same day updates the alert rather
than stacking up duplicates.

The daily alert looks **three days** ahead, while the page itself shows five —
so the page will usually list a few things the morning alert did not mention
yet. That is deliberate: a daily nudge about something a working week away stops
being a nudge.

**A text message is optional and currently switched off** for this deployment —
there is no SMS provider configured. The in-app alert is not affected by that in
any way; it is the channel that always works. If texting is ever switched on,
you turn it on for yourself under Settings → Waste Alerts and it becomes an
extra on top, never a replacement.

---

## Meal planning

**Meal Plan** shows one week at a time, all seven days, with the empty ones
visible — so you can see that Thursday has nothing on it before Thursday
arrives. Arrows move between weeks.

### Scheduling

Add a meal to a day by picking a recipe from your library or typing a free-text
meal. Move a meal by dragging it to another day, or by choosing a new day from
the menu on the card.

### Generating a week

**Generate plan** builds the week for you around whatever is closest to going
off, allowing for your dietary needs, the ingredients you have said you dislike,
and the nights your HelloFresh box already covers.

If the AI planner is unavailable, you still get a plan — built locally from what
is expiring in your kitchen — and the page tells you the AI was skipped rather
than failing or silently giving you something worse.

### The shopping list

The week's shopping list builds itself from the meals on it, and separates out
what you already have from what you need to buy.

### Batch cooking

When two meals in the week share prep or oven time, you get a nudge to cook them
together — one tray of roast vegetables for Sunday and Tuesday rather than two
sessions at the stove.

### Cooking

Tick a meal **Cooked** and its ingredients come out of your inventory
automatically. The toast tells you what was taken, so you can see it happened.

---

## The dashboard

The home screen, and a live read of the kitchen rather than a cached one.

Four counts across the top — total items, how many are expiring soon (within
five days), how many recipes you have, and how many meals are planned this week.
Each is a link to the page behind it.

Below that: **urgent alerts**, listing what to cook first with the worst offender
at the top; a **preview of the week**, showing all seven days and their gaps; and
**quick actions** for the things you do most.

If a part of the app has no data yet, the dashboard shows an empty state rather
than an error or a blank tile.

---

## Analytics

**Analytics** is built entirely from the prices and shops you type in when you
add items. Until you have typed some, the page says so and explains what to fill
in — it will not show you an empty chart and let you wonder.

Once there is data:

- What you buy most often, and what it usually costs
- How your grocery spend moves month to month, over the last six months
- Which shop has been cheapest for each thing

Every chart has a **View as table** link underneath. The numbers are the point;
if you would rather read them straight than squint at a graph, the table says
the same thing.

---

## Settings

Four sections:

- **Profile** — your display name and a phone number for alerts.
- **Password** — change it. Needs your current one, and a new one of at least
  six characters.
- **Storage Locations** — add, rename, recolour and delete locations, as above.
- **Waste Alerts** — whether you want the daily nudge, and whether you want it
  as a text as well as in the app.

---

## Installing it on your phone

MyKitchenHub is a progressive web app: open it in your phone browser and add it
to your home screen and it behaves like an installed app. It prompts you when it
can.

Installed, it works offline for reading — you can check what is in your fridge
while standing in a shop with no signal. Changes need a connection.

When a new version is deployed you get a prompt to refresh. The **What's New**
popup then shows what changed, including anything you missed if several releases
stacked up between visits. The version at the bottom of the screen tells you
exactly which build you are on, which is the useful thing to quote when
reporting a problem — there is a **"Report a bug or request a feature"** link in
the footer.
