import {
  formatDuration,
  fromRow,
  isDone,
  msUntilNextEnd,
  newTimerRow,
  remainingMs,
  remainingSeconds,
  ringing,
  sortTimers,
  stepKey,
  stepMinutes,
  timerForKey,
  timerText,
} from '../timerLogic';

const NOW = Date.parse('2026-11-25T18:00:00Z');
const t = (id, secondsFromNow, extra = {}) => ({
  id,
  label: id,
  endsAt: NOW + secondsFromNow * 1000,
  ...extra,
});

describe('a timer is its end time', () => {
  it('stores when it ends, not a count', () => {
    const row = newTimerRow({ label: ' Pasta ', minutes: 9, now: NOW });
    expect(row).toEqual({
      key: null,
      label: 'Pasta',
      duration_s: 540,
      ends_at: '2026-11-25T18:09:00.000Z',
    });
  });

  it('reads back the same way on any device, whenever it is opened', () => {
    const timer = fromRow({
      id: 'a',
      key: 'k',
      label: 'Pasta',
      duration_s: 540,
      ends_at: '2026-11-25T18:09:00Z',
    });
    expect(timer).toEqual({
      id: 'a',
      key: 'k',
      label: 'Pasta',
      durationS: 540,
      endsAt: NOW + 540000,
    });
    // A reload four minutes later still knows exactly what is left.
    expect(remainingSeconds(timer, NOW + 4 * 60000)).toBe(300);
    expect(timerText(timer, NOW + 4 * 60000)).toBe('5:00');
  });

  it('names a timer by its length when it has no name', () => {
    expect(newTimerRow({ minutes: 90, now: NOW }).label).toBe('1:30:00 timer');
    expect(newTimerRow({ seconds: 45, now: NOW }).label).toBe('0:45 timer');
  });

  it('refuses a time that cannot be a timer', () => {
    expect(newTimerRow({ minutes: 0 })).toBeNull();
    expect(newTimerRow({ minutes: -5 })).toBeNull();
    expect(newTimerRow({ minutes: 'soon' })).toBeNull();
    expect(newTimerRow({ minutes: 24 * 60 + 1 })).toBeNull();
  });

  it('keeps keys and names to the size the database takes', () => {
    const row = newTimerRow({ label: 'x'.repeat(300), key: 'k'.repeat(300), minutes: 1 });
    expect(row.label).toHaveLength(120);
    expect(row.key).toHaveLength(200);
  });
});

describe('counting down from the clock', () => {
  it('rounds up, so a timer shows 0:01 until it is done', () => {
    const timer = t('a', 0.2);
    expect(remainingSeconds(timer, NOW)).toBe(1);
    expect(timerText(timer, NOW)).toBe('0:01');
    expect(isDone(timer, NOW)).toBe(false);
  });

  it('is done from its end time on, and never negative', () => {
    const timer = t('a', 10);
    expect(isDone(timer, NOW + 10000)).toBe(true);
    expect(remainingMs(timer, NOW + 60000)).toBe(0);
    expect(timerText(timer, NOW + 60000)).toBe('Done');
  });

  it('formats minutes and hours', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-3)).toBe('0:00');
  });
});

describe('several timers at once', () => {
  const timers = [t('later', 600), t('rang-long-ago', -300), t('soon', 60), t('just-rang', -5)];

  it('puts ringing ones first, then the next to end', () => {
    expect(sortTimers(timers, NOW).map((x) => x.id)).toEqual([
      'rang-long-ago',
      'just-rang',
      'soon',
      'later',
    ]);
  });

  it('rings for every finished one', () => {
    expect(
      ringing(timers, NOW)
        .map((x) => x.id)
        .sort()
    ).toEqual(['just-rang', 'rang-long-ago']);
  });

  it('knows when to wake up next', () => {
    expect(msUntilNextEnd(timers, NOW)).toBe(60000);
    expect(msUntilNextEnd([t('done', -1)], NOW)).toBeNull();
  });

  it('finds the timer a step started', () => {
    const key = stepKey('r1', 2);
    expect(key).toBe('recipe:r1:2');
    expect(timerForKey([t('a', 5, { key })], key).id).toBe('a');
    expect(timerForKey([], key)).toBeNull();
  });
});

describe('stepMinutes', () => {
  it.each([
    ['Roast for 15 minutes', 15],
    ['Simmer 10–12 min, stirring', 10],
    ['Bake 1 hour', 60],
    ['Rest for 1.5 hrs', 90],
    ['Season to taste', null],
    ['Stir for 30 seconds', null],
    ['', null],
  ])('%s → %s', (text, expected) => {
    expect(stepMinutes(text)).toBe(expected);
  });
});
