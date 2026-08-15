// src/utils/__tests__/retry.test.js

import { withRetry, DEFAULT_ATTEMPTS } from '../retry';

const firebaseError = (code) => Object.assign(new Error(code), { code });

describe('withRetry', () => {
  it('returns the value without retrying when the call succeeds', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and returns the eventual success', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(firebaseError('unavailable'))
      .mockResolvedValue('ok');

    await expect(withRetry(fn, { backoffMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured number of attempts and rethrows', async () => {
    const err = firebaseError('unavailable');
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { backoffMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(DEFAULT_ATTEMPTS);
  });

  it('does not retry a rejection the person needs to see', async () => {
    const err = firebaseError('permission-denied');
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { backoffMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off further each time', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn().mockRejectedValue(firebaseError('unavailable'));

    await expect(withRetry(fn, { backoffMs: 10, onRetry })).rejects.toBeDefined();

    expect(onRetry.mock.calls.map(([info]) => info.delayMs)).toEqual([10, 20]);
  });

  it('honours a caller-supplied retry test', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValue('ok');

    await expect(withRetry(fn, { backoffMs: 1, shouldRetry: () => true })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects a single-attempt budget', async () => {
    const fn = jest.fn().mockRejectedValue(firebaseError('unavailable'));
    await expect(withRetry(fn, { attempts: 1, backoffMs: 1 })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
