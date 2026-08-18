// src/config/whatsNew.js
// End-user "What's New" entries — NEWEST FIRST.
//
// When you ship user-facing changes, bump `version` (use today's date as
// YYYY.MM.DD) and add a new entry at the top with plain-language,
// benefit-focused bullets. The next time each person opens the app, the popup
// shows every entry newer than what their device last saw — so if several
// releases stacked up between visits, they see them all at once (tracked
// per-device in localStorage).
//
// Skip adding an entry when a release has nothing a user would notice
// (refactors, config, infra) — the popup only fires when a newer `version`
// appears.

export const WHATS_NEW = [
  {
    version: '2026.08.15.6',
    date: 'August 2026',
    items: [
      '\u{1F50D} The recipe filters now fold away. On a phone the tag list and the four dropdowns used to fill the screen before a single recipe appeared \u2014 tap \u201cFilters\u201d to open them, and the button tells you how many you have on.',
      '\u{1F3F7}\uFE0F Only the first dozen tags are shown now, with a \u201c+ more\u201d for the rest. A tag you have switched on always stays visible, so you can always switch it off again.',
      '\u{1F4C4} Long forms scroll properly. Adding an item, a storage place, or importing a spreadsheet no longer pushes the Save button off the bottom of a small screen.',
      '\u{1F44D} Taps land straight away instead of pausing first, and the app no longer drifts off-centre if you pinch or double-tap by accident.',
    ],
  },
  {
    version: '2026.08.15.5',
    date: 'August 2026',
    items: [
      '📶 The row of buttons along the bottom of your phone no longer disappears when the signal drops. The “you’re offline” message used to sit right on top of it — so the moment you needed the app to keep working, you could not get around it.',
      '🖼️ A photo with a see-through background no longer comes out with a black one when you add it to a recipe.',
      '🙈 If something does go wrong, the message you see can no longer accidentally carry a web address or a long string of letters and numbers from behind the scenes.',
      '🔁 Signing up on a patchy connection is safer. If your kitchen was set up but the app could not read it back straight away, it no longer tells you signing up failed when everything is in fact ready and waiting.',
    ],
  },
  {
    version: '2026.08.15.4',
    date: 'August 2026',
    items: [
      '🔒 Recipes other cooks added are now properly theirs. The delete button only shows on recipes you added yourself — and a recipe someone else put in the shared book can no longer be removed by anyone but them. You can still fix a typo or tick off that you cooked it.',
    ],
  },
  {
    version: '2026.08.15.3',
    date: 'August 2026',
    items: [
      '📱 The app now has a row of buttons along the bottom on your phone — kitchen, recipes, and what needs eating are one tap away instead of three.',
      '👆 Every button, link and box is now big enough to hit with a thumb, including the fiddly little ones.',
      '⚡ Opening the app is quicker: it now downloads only the page you asked for instead of all eight at once.',
      '📶 It keeps working when the signal drops. Your kitchen is still there to look at, and anything you add is saved as soon as you are back.',
      '🔔 The bell at the top finally shows how many things are about to go off. It had been stuck on nothing this whole time.',
      '💬 When something goes wrong it now says what happened in plain English, instead of showing a code only a developer could read.',
      '📷 Recipe photos are shrunk before they are saved, so adding one does not eat your data.',
    ],
  },
  {
    version: '2026.08.15.2',
    date: 'August 2026',
    items: [
      '📖 There is a proper guide now. Every part of the app — your fridge, your recipes, your HelloFresh box, the weekly plan — written up in plain English, with a troubleshooting page for when something looks wrong.',
      '🔒 Your kitchen is locked down properly. Only you can touch your food, your shopping and your week, and nobody can delete a recipe out of the shared library that they did not add themselves.',
      '❄️ Your default fridge, freezer and pantry can no longer be removed by accident.',
      '🩹 Editing something can no longer quietly leave it without a name — a few edits used to be able to blank out the very thing you were looking at.',
    ],
  },
  {
    version: '2026.08.15.1',
    date: 'August 2026',
    items: [
      '🛒 The shopping list is better at arithmetic. It no longer adds 2 cups of flour to 200g of flour and asks you to buy 202 cups, and when you already have some of something it tells you how much instead of quietly making you buy the lot again.',
      '📅 “Generate plan” now leaves alone any night you have already sorted — a meal you added yourself, one from your HelloFresh box, or one you added from Waste Alerts — instead of putting a second dinner on top of it.',
      '🍳 Ticking “Cooked” twice no longer takes the ingredients out of your kitchen twice.',
      '🗑️ Ticked the wrong meal, or planned a recipe you have since deleted? You can now take a cooked meal back off the board.',
    ],
  },
  {
    version: '2026.08.15',
    date: 'August 2026',
    items: [
      '📆 Expiry dates now read the way you would say them. Something stamped for today says “Expires today” right up to bedtime, instead of flipping to “tomorrow” for most of the day — and the morning alert and the app finally agree with each other.',
      '❄️ Freezer suggestions stopped offering to rescue food that has already gone off. Freezing keeps things; it cannot bring them back, and it used to promise nine more months on last week’s chicken.',
      '⏳ If you set your own use-by on something, the freezer now tells you what freezing will really buy you, and half a pack keeps the same date as the half you left out.',
      '🥚 A recipe calling for “egg” now finds the eggs in your fridge. Singular and plural no longer count as different food.',
      '🎉 When nothing is about to go off, the Waste Alerts page just says so, once — instead of four separate panels each reporting nothing.',
      '📥 Imported food now gets the right shelf life for what it actually is — chicken two days, rice two years — and if your file set a use-by date, we leave it exactly as you put it.',
    ],
  },
  {
    version: '2026.08.14.6',
    date: 'August 2026',
    items: [
      '📖 Recipes are here. Everything you cook lives in one place — search it by name, by tag, or by an ingredient you need to use up.',
      '➕ Add your own recipes: type the ingredients with autocomplete from your own kitchen, build the steps one at a time, and add a photo.',
      '✅ Open a recipe and the ingredients you already have are ticked off, so you know what to buy before you start.',
      '👨\u200d🍳 Tap “I cooked this” and the app keeps count, so you can see which meals are actually in your rotation.',
      '✏️ Changed your mind about a recipe you added? Edit it, or delete it after a confirmation.',
    ],
  },
  {
    version: '2026.08.14.5',
    date: 'August 2026',
    items: [
      '📸 Snap a photo of your HelloFresh recipe card and the app reads the ingredients and steps off it. You get to check everything before it is saved.',
      '🔗 Got the link instead? Paste a HelloFresh recipe link and it fills itself in. No card and no link — type it in yourself.',
      '📦 Tell the app your box arrived and every ingredient goes straight into your fridge with its own use-by date, so nothing gets forgotten at the back.',
      '🗓️ Your box’s meals land straight on your Meal Plan — one on delivery day, then every other evening — so you are not cooking three dinners on a Monday.',
      '🚚 A new delivery history shows every box you have logged, what came in it, and how much it stocked your kitchen.',
    ],
  },
  {
    version: '2026.08.14.4',
    date: 'August 2026',
    items: [
      '🏠 Your dashboard is live. It now counts what is actually in your kitchen, how much of it is about to go off, how many recipes you have, and how many dinners are planned this week.',
      '⏰ “Urgent alerts” lists the things to cook first, worst offender at the top, so nothing quietly rots at the back of the fridge.',
      '🗓️ The week now shows all seven days at a glance, with the gaps visible — so you can see Thursday has nothing on it before Thursday arrives.',
      '📊 New Analytics page: what you buy most often, what it usually costs, how your grocery spend moves month to month, and which shop was cheapest for each thing.',
      '📋 Every chart has a “View as table” link, so you can read the numbers straight if you would rather not squint at a graph.',
    ],
  },
  {
    version: '2026.08.14.3',
    date: 'August 2026',
    items: [
      '⚠️ New Waste Alerts page: everything about to go off, in one place, worst first.',
      '❄️ Move something to the freezer and it now actually keeps longer — one tap for “Freeze All”, or freeze half and cook the rest tonight.',
      '🍳 See which recipes use up what is about to expire, and add one to your meal plan in a tap.',
      '📅 Expiry dates are smarter: chicken gets two days in the fridge, rice gets two years in the pantry. Type your own number any time and we will leave it alone.',
      '🔔 A daily morning alert tells you what needs eating. Turn on a text as well in Settings → Waste Alerts.',
    ],
  },
  {
    version: '2026.08.14.2',
    date: 'August 2026',
    items: [
      '📅 Meal Plan is here: a week at a glance, with dinner on every day. Drag a meal to a different night, or pick a new day from the menu on the card.',
      '✨ Tap “Generate plan” and the week gets planned around whatever is closest to going off in your fridge — allowing for your dietary needs, the things you don’t like, and the nights your HelloFresh box already covers.',
      '🛒 The shopping list builds itself from the week’s meals, and quietly separates out what you already have.',
      '🍳 Tick “Cooked” when dinner is done and the ingredients come straight out of your kitchen count — no more updating it by hand.',
      '🥘 When two meals share prep or oven time, you’ll get a nudge to cook them together and save yourself a second session at the stove.',
    ],
  },
  {
    version: '2026.08.14.1',
    date: 'August 2026',
    items: [
      '📄 Stocking the app from scratch no longer means typing every item in one at a time — hit “Import CSV” on the Inventory screen and bring in a whole spreadsheet at once.',
      '👀 Before anything is saved, you see exactly which rows will be added and which need a fix, with the line number and the reason for each one.',
      '🧊 Put “Main Fridge”, or just “fridge”, in the location column — either way the item lands where you keep it, with an expiry date already worked out.',
      '🧾 Every import is logged, so you can look back and see what that spreadsheet actually added.',
    ],
  },
  {
    version: '2026.08.14',
    date: 'August 2026',
    items: [
      '🏷️ Your default storage locations (Main Fridge, Freezer, Pantry, Counter) now show their names properly instead of appearing blank.',
      '📴 Offline mode actually works now — the app caches itself properly so you can check your kitchen without a signal.',
      '🔢 The version at the bottom of the screen now tells you exactly which build you are on.',
    ],
  },
  {
    version: '2026.07.26',
    date: 'July 2026',
    items: [
      '🐛 Spot a bug or have an idea? There’s now a “Report a bug or request a feature” link in the footer.',
    ],
  },
];
