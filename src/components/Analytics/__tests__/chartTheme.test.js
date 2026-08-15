// The palette is a contract, not a preference: these values were validated
// against the white card surface and the formatters are what stop a missing
// price rendering as "$NaN".

import {
  SERIES,
  SERIES_COUNT,
  SERIES_MONEY,
  MAX_BAR_SIZE,
  BAR_RADIUS,
  formatCurrency,
  formatCurrencyShort,
  formatPurchases,
} from '../chartTheme';

/** Relative luminance, per WCAG. */
const luminance = (hex) => {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrastVsWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

describe('chart palette', () => {
  it('is a fixed list of hex slots, assigned in order', () => {
    expect(SERIES).toHaveLength(3);
    SERIES.forEach((hex) => expect(hex).toMatch(/^#[0-9a-f]{6}$/));
    expect(SERIES_COUNT).toBe(SERIES[0]);
    expect(SERIES_MONEY).toBe(SERIES[1]);
  });

  it('clears 3:1 against the white card surface every mark sits on', () => {
    SERIES.forEach((hex) => expect(contrastVsWhite(hex)).toBeGreaterThanOrEqual(3));
  });

  it('never repeats a hue, so two series can never collide', () => {
    expect(new Set(SERIES).size).toBe(SERIES.length);
  });

  it('caps bar thickness and rounds only the data end', () => {
    expect(MAX_BAR_SIZE).toBeLessThanOrEqual(24);
    // [top-left, top-right, bottom-right, bottom-left] — square at the baseline.
    expect(BAR_RADIUS).toEqual([0, 4, 4, 0]);
  });
});

describe('formatters', () => {
  it.each([
    [12.99, '$12.99'],
    [0, '$0.00'],
    [4, '$4.00'],
  ])('renders %p as %p', (value, expected) => {
    expect(formatCurrency(value)).toBe(expected);
  });

  it.each([[null], [undefined], [NaN], ['4.00']])(
    'renders %p as a dash rather than $NaN',
    (value) => {
      expect(formatCurrency(value)).toBe('—');
    }
  );

  it.each([
    [0, '$0'],
    [48.4, '$48'],
    [1200, '$1.2k'],
  ])('shortens %p to %p for an axis tick', (value, expected) => {
    expect(formatCurrencyShort(value)).toBe(expected);
  });

  it('gives an empty axis tick for a non-number', () => {
    expect(formatCurrencyShort(null)).toBe('');
  });

  it('pluralises purchase counts', () => {
    expect(formatPurchases(1)).toBe('1 time');
    expect(formatPurchases(4)).toBe('4 times');
    expect(formatPurchases(0)).toBe('0 times');
  });
});
