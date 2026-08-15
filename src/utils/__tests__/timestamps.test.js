// The date adapters everything else on the dashboard leans on. A `null` here
// instead of an Invalid Date is the difference between an empty tile and NaN
// rendered to a user.

import { toDate, monthKey, monthLabel, recentMonthKeys } from '../timestamps';
import { Timestamp } from '../../test-utils/mocks/firestore';

describe('toDate', () => {
  it('unwraps a Firestore Timestamp', () => {
    const when = new Date('2026-03-04T10:00:00Z');
    expect(toDate(Timestamp.fromDate(when))).toEqual(new Date(Math.floor(when / 1000) * 1000));
  });

  it('passes a Date straight through', () => {
    const when = new Date('2026-03-04T10:00:00Z');
    expect(toDate(when)).toBe(when);
  });

  it('parses the ISO strings the emulator seed writes', () => {
    expect(toDate('2026-03-04T10:00:00.000Z')).toEqual(new Date('2026-03-04T10:00:00.000Z'));
  });

  it('accepts epoch millis', () => {
    expect(toDate(1772618400000)).toEqual(new Date(1772618400000));
  });

  it('reads a raw {seconds} object, as an unresolved server write leaves it', () => {
    expect(toDate({ seconds: 1772618400 })).toEqual(new Date(1772618400000));
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['nonsense', 'not a date'],
    ['a plain object', { nope: true }],
  ])('returns null for %s rather than an Invalid Date', (_label, value) => {
    expect(toDate(value)).toBeNull();
  });

  it('returns null when toDate() itself throws', () => {
    expect(
      toDate({
        toDate() {
          throw new Error('unresolved sentinel');
        },
      })
    ).toBeNull();
  });

  it('returns null when toDate() hands back something that is not a Date', () => {
    // Anything else escaping here reaches monthKey, which calls .getFullYear()
    // on it and takes the page down with a TypeError.
    expect(toDate({ toDate: () => 'March' })).toBeNull();
    expect(toDate({ toDate: () => undefined })).toBeNull();
    expect(toDate({ toDate: () => new Date('nope') })).toBeNull();
  });

  it('does not crash monthKey when a document holds a broken timestamp', () => {
    expect(monthKey({ toDate: () => 'March' })).toBeNull();
  });

  it('reads the epoch rather than treating 0 as missing', () => {
    expect(toDate(0)).toEqual(new Date(0));
  });

  it('returns null for a boolean, which is neither a date nor a number', () => {
    expect(toDate(false)).toBeNull();
    expect(toDate(true)).toBeNull();
  });

  it('trims a padded ISO string rather than failing on the whitespace', () => {
    expect(toDate('  2026-03-04T10:00:00.000Z  ')).toEqual(new Date('2026-03-04T10:00:00.000Z'));
  });

  it('returns null for a day that does not exist', () => {
    // new Date(2026, 1, 31) silently rolls into March; a "best by 2026-02-31"
    // is bad data and has to read as absent, not as the 3rd of March.
    expect(toDate('2026-02-31')).toBeNull();
    expect(toDate('2026-13-01')).toBeNull();
    expect(toDate('2026-00-10')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Timezones and DST
//
// A jest worker cannot change its own zone — jest hands the test a copied
// `process.env`, so assigning TZ never reaches the runtime's tzset(). These
// assertions are therefore written to hold in *any* zone, and the suite is run
// a second time under a non-UTC one (`npm run test:tz`, and the `unit-tz` CI
// job) where the wrong answers actually differ from the right ones.
// ---------------------------------------------------------------------------

/** Minutes the local zone is behind UTC on a given day. 0 on a UTC runner. */
const offsetOn = (year, month, day) => new Date(year, month, day).getTimezoneOffset();

describe('timezones and DST', () => {
  it('reads a bare day string as that local day, not as midnight UTC', () => {
    const d = toDate('2026-03-01');

    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);

    // The bug this pins: `new Date('2026-03-01')` is midnight *UTC*, which is
    // the 28th of February anywhere west of Greenwich. On a UTC runner the two
    // coincide; under test:tz they are an hour-count apart.
    expect(d.getTime() - Date.parse('2026-03-01')).toBe(offsetOn(2026, 2, 1) * 60_000);
  });

  it('buckets the first of the month into that month, not the one before', () => {
    expect(monthKey('2026-03-01')).toBe('2026-03');
    expect(monthKey('2026-01-01')).toBe('2026-01');
  });

  it('buckets the last of the month into that month, not the one after', () => {
    expect(monthKey('2026-03-31')).toBe('2026-03');
    expect(monthKey('2026-12-31')).toBe('2026-12');
  });

  it('keeps an explicit instant an instant, offset and all', () => {
    // A full ISO timestamp carries its own zone; only bare days are local.
    expect(toDate('2026-03-01T05:30:00.000Z').toISOString()).toBe('2026-03-01T05:30:00.000Z');
  });

  it('lands on the right day even where local midnight does not exist', () => {
    // Some zones start daylight time at midnight (Santiago, Beirut), so
    // `new Date(y, m, d)` rolls to 01:00 — the same calendar day, which is all
    // the month buckets and the expiry windows read.
    ['2026-03-08', '2026-09-06', '2026-10-25', '2026-11-01'].forEach((day) => {
      const d = toDate(day);
      expect(d).not.toBeNull();
      expect(monthKey(day)).toBe(day.slice(0, 7));
      expect(String(d.getDate()).padStart(2, '0')).toBe(day.slice(-2));
    });
  });

  it('spans a DST change without dropping or repeating a month', () => {
    // November 2025 → March 2026 crosses both ends of northern daylight time.
    expect(recentMonthKeys(5, new Date(2026, 2, 31, 23, 30))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });

  it('steps back from the 31st without skipping the short months', () => {
    expect(recentMonthKeys(3, new Date(2026, 2, 31))).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(recentMonthKeys(2, new Date(2026, 4, 31))).toEqual(['2026-04', '2026-05']);
  });
});

describe('month bucketing', () => {
  it('builds a sortable YYYY-MM key', () => {
    expect(monthKey(new Date('2026-03-04T00:00:00'))).toBe('2026-03');
  });

  it('returns null for an unparseable date', () => {
    expect(monthKey('nonsense')).toBeNull();
  });

  it('labels a month in the current year with just the month', () => {
    expect(monthLabel('2026-08', new Date('2026-08-14'))).toBe('Aug');
  });

  it('adds the year when it differs, so December is not ambiguous', () => {
    expect(monthLabel('2025-12', new Date('2026-08-14'))).toBe('Dec ’25');
  });

  it.each([['not-a-key'], [null], ['2026-99']])('returns an empty label for %s', (key) => {
    expect(monthLabel(key, new Date('2026-08-14'))).toBe('');
  });

  it('lists the trailing months oldest first, ending with the current one', () => {
    expect(recentMonthKeys(4, new Date('2026-02-14'))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('returns no months when asked for none', () => {
    expect(recentMonthKeys(0, new Date('2026-02-14'))).toEqual([]);
  });

  it('falls back to now rather than throwing on a non-Date anchor', () => {
    expect(recentMonthKeys(1, 'nonsense')).toEqual([monthKey(new Date())]);
    expect(monthLabel('2026-08', 'nonsense')).toBe(monthLabel('2026-08', new Date()));
  });

  it('labels a month against a Firestore Timestamp reference', () => {
    expect(monthLabel('2025-12', Timestamp.fromDate(new Date(2026, 7, 14)))).toBe('Dec ’25');
  });
});
