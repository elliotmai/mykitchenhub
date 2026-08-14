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
