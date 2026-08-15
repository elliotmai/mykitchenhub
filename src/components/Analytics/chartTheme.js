// src/components/Analytics/chartTheme.js
// The chart half of the design system.
//
// The pastel tokens in src/styles/design-system.css are surface colours — as
// data marks on a white card they sit far too light to read (--mkh-primary
// #a8d5e2 is only 1.4:1 against #ffffff). These are deeper steps of the *same*
// hue families, chosen so the charts still look like the rest of the app while
// actually being legible.
//
// The palette is validated, not eyeballed. Against the white card surface, with
// every pair checked (not just neighbours):
//
//   lightness band     PASS  all 3 inside OKLCH L 0.43–0.77
//   chroma floor       PASS  all 3 >= 0.10
//   CVD separation     PASS  worst pair ΔE 8.7 (deutan), target >= 8
//   normal-vision      PASS  worst pair ΔE 16.6, floor >= 15
//   contrast           PASS  all 3 >= 3:1 vs #ffffff
//
// Re-run before changing any hex below:
//   node scripts/validate_palette.js "#1a6d9c,#c4692b,#38956a" \
//     --mode light --surface "#ffffff" --pairs all
//
// The app ships a single light theme (design-system.css defines no dark
// palette), so there is deliberately no dark step here.

/** Categorical slots, in fixed order. Never cycle past the last one. */
export const SERIES = ['#1a6d9c', '#c4692b', '#38956a'];

/** Slot 1 — counts and frequencies. */
export const SERIES_COUNT = SERIES[0];

/** Slot 2 — money. Kept distinct from counts so a spend chart never reads as a tally. */
export const SERIES_MONEY = SERIES[1];

/** Chart chrome, mirroring the design-system tokens by value. */
export const CHART_SURFACE = '#ffffff'; // --mkh-bg-card
export const CHART_GRID = '#eceae5'; // --mkh-border-light
export const CHART_AXIS = '#e0ded9'; // --mkh-border
export const TEXT_MUTED = '#95a5a6'; // --mkh-text-muted
export const TEXT_SECONDARY = '#7f8c8d'; // --mkh-text-secondary
export const TEXT_PRIMARY = '#2c3e50'; // --mkh-text-primary

/** Bars are capped rather than filling their band, so the gap does the separating. */
export const MAX_BAR_SIZE = 24;

/** 4px rounded data-end, square at the baseline — horizontal bars grow right. */
export const BAR_RADIUS = [0, 4, 4, 0];

/** Shared axis tick styling: text tokens, never the series colour. */
export const AXIS_TICK = { fill: TEXT_MUTED, fontSize: 12 };

/** Tooltip chrome, matching the app's card surface. */
export const TOOLTIP_STYLE = {
  backgroundColor: CHART_SURFACE,
  border: `1px solid ${CHART_AXIS}`,
  borderRadius: 8,
  boxShadow: '0 4px 6px rgba(44, 62, 80, 0.07)',
  color: TEXT_PRIMARY,
  fontSize: 13,
};

/** `12.99` → `$12.99`; null → an em dash rather than `$NaN`. */
export const formatCurrency = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
};

/** Axis-friendly money: `$0`, `$48`, `$1.2k`. */
export const formatCurrencyShort = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
};

/** `1` → `1 time`, `4` → `4 times`. */
export const formatPurchases = (count) => `${count} ${count === 1 ? 'time' : 'times'}`;
