/**
 * The alert wording. The clock is injected everywhere so these tests read the
 * same in August as in January.
 */

const {
  SMS_MAX_LENGTH,
  daysUntil,
  describeTiming,
  formatAlertMessage,
} = require('../alertMessage');

const NOW = new Date('2026-08-14T09:00:00Z');

const at = (isoDate) => new Date(isoDate);

const item = (name, expiresAt) => ({ name, expiresAt });

describe('daysUntil', () => {
  it('counts whole calendar days, not elapsed hours', () => {
    // 9am today to 11pm tomorrow is one day away, not two.
    expect(daysUntil(at('2026-08-15T23:00:00Z'), NOW)).toBe(1);
  });

  it('goes negative for something already past its date', () => {
    expect(daysUntil(at('2026-08-12T09:00:00Z'), NOW)).toBe(-2);
  });

  it('accepts a Firestore Timestamp', () => {
    const timestamp = { toDate: () => at('2026-08-16T09:00:00Z') };
    expect(daysUntil(timestamp, NOW)).toBe(2);
  });

  it('returns null for a missing or unparseable date', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('not a date', NOW)).toBeNull();
  });
});

describe('describeTiming', () => {
  it.each([
    ['expired', '2026-08-12T09:00:00Z'],
    ['today', '2026-08-14T18:00:00Z'],
    ['tomorrow', '2026-08-15T09:00:00Z'],
    ['in 3 days', '2026-08-17T09:00:00Z'],
  ])('says "%s"', (expected, iso) => {
    expect(describeTiming(at(iso), NOW)).toBe(expected);
  });
});

describe('formatAlertMessage', () => {
  const spinach = item('spinach', at('2026-08-14T18:00:00Z'));
  const milk = item('milk', at('2026-08-15T09:00:00Z'));
  const yogurt = item('yogurt', at('2026-08-12T09:00:00Z'));

  it('says nothing at all when there is nothing to say', () => {
    expect(formatAlertMessage([], { now: NOW })).toBeNull();
  });

  it('names each item and when it goes', () => {
    const message = formatAlertMessage([spinach, milk], { now: NOW });

    expect(message.sms).toContain('spinach (today)');
    expect(message.sms).toContain('milk (tomorrow)');
    expect(message.itemCount).toBe(2);
  });

  it('calls out food that has already gone past its date', () => {
    const message = formatAlertMessage([yogurt, spinach], { now: NOW });
    expect(message.title).toMatch(/1 already past its date/);
  });

  it('keeps the headline calm when nothing has expired yet', () => {
    const message = formatAlertMessage([spinach, milk], { now: NOW });
    expect(message.title).toBe('2 items to use up soon');
  });

  it('gets the singular right for one item', () => {
    const message = formatAlertMessage([spinach], { now: NOW });
    expect(message.title).toBe('1 item to use up soon');
    expect(message.sms).toContain('1 item to use up');
  });

  it('names the first three and counts the rest', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n) => item(n, at('2026-08-15T09:00:00Z')));
    const message = formatAlertMessage(many, { now: NOW });

    expect(message.sms).toContain('a (tomorrow)');
    expect(message.sms).toContain('and 2 more');
    expect(message.sms).not.toContain('d (');
  });

  it('tells the cook what to do, not just what is wrong', () => {
    const message = formatAlertMessage([spinach], { now: NOW });
    expect(message.body).toMatch(/freeze/i);
    expect(message.body).toMatch(/cook something/i);
  });

  it('keeps the SMS short enough not to fragment into a wall of texts', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      item(`a very long ingredient name number ${i}`, at('2026-08-15T09:00:00Z'))
    );
    const message = formatAlertMessage(many, { now: NOW });

    expect(message.sms.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });

  it('copes with an item whose expiry cannot be read', () => {
    const message = formatAlertMessage([item('mystery jar', null)], { now: NOW });
    expect(message.sms).toContain('mystery jar (soon)');
  });
});
