// The date adapters everything else on the dashboard leans on. A `null` here
// instead of an Invalid Date is the difference between an empty tile and NaN
// rendered to a user.

import {
  toDate,
  startOfWeekMonday,
  endOfWeekMonday,
  isSameWeek,
  monthKey,
  monthLabel,
  recentMonthKeys,
} from '../timestamps';
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
});

describe('week boundaries', () => {
  it('starts the week on Monday at midnight', () => {
    // 2026-08-14 is a Friday.
    const monday = startOfWeekMonday(new Date('2026-08-14T15:30:00'));
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(10);
    expect(monday.getHours()).toBe(0);
  });

  it('treats Sunday as the end of the week it started, not the beginning of the next', () => {
    const monday = startOfWeekMonday(new Date('2026-08-16T09:00:00')); // Sunday
    expect(monday.getDate()).toBe(10);
  });

  it('ends the week exactly seven days after it starts', () => {
    const start = startOfWeekMonday(new Date('2026-08-14T15:30:00'));
    const end = endOfWeekMonday(new Date('2026-08-14T15:30:00'));
    expect(end - start).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('isSameWeek', () => {
  const friday = new Date('2026-08-14T12:00:00');

  it('accepts a date inside the same Monday-based week', () => {
    expect(isSameWeek(new Date('2026-08-10T00:00:00'), friday)).toBe(true);
    expect(isSameWeek(new Date('2026-08-16T23:00:00'), friday)).toBe(true);
  });

  it('rejects the week either side', () => {
    expect(isSameWeek(new Date('2026-08-09T23:59:00'), friday)).toBe(false);
    expect(isSameWeek(new Date('2026-08-17T00:00:00'), friday)).toBe(false);
  });

  it('rejects a missing date rather than throwing', () => {
    expect(isSameWeek(null, friday)).toBe(false);
    expect(isSameWeek(undefined, friday)).toBe(false);
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
});
