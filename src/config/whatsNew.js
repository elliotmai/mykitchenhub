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
