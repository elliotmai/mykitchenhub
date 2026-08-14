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
      '⚠️ New Waste Alerts page: everything about to go off, in one place, worst first.',
      '❄️ Move something to the freezer and it now actually keeps longer — one tap for “Freeze All”, or freeze half and cook the rest tonight.',
      '🍳 See which recipes use up what is about to expire, and add one to your meal plan in a tap.',
      '📅 Expiry dates are smarter: chicken gets two days in the fridge, rice gets two years in the pantry. Type your own number any time and we will leave it alone.',
      '🔔 A daily morning alert tells you what needs eating. Turn on a text as well in Settings → Waste Alerts.',
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
