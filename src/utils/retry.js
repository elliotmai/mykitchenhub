// src/utils/retry.js
// Retries a call that failed for a reason that might not still be true —
// roadmap 9.3.
//
// A phone on a train loses its connection for a second at a time. Without this,
// tapping "Add" during one of those seconds throws away everything the cook
// typed and shows an error. With it, the write quietly succeeds on the second
// attempt and they never find out.
//
// Only transient failures are retried (see isRetryable). A rejected write stays
// rejected: retrying `permission-denied` just delays the message that matters.

import { isRetryable } from './firebaseErrors';

/** Attempts, including the first. Two retries covers a brief connection blip. */
export const DEFAULT_ATTEMPTS = 3;

/** First backoff, in ms. Doubles each attempt: 300ms, then 600ms. */
export const DEFAULT_BACKOFF_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying while it fails transiently.
 *
 * @param {() => Promise<T>} fn                what to (re)run — must be safe to
 *                                             run twice, so callers pass writes
 *                                             that are idempotent or that only
 *                                             fail before taking effect
 * @param {object}  [options]
 * @param {number}  [options.attempts]         total tries, including the first
 * @param {number}  [options.backoffMs]        delay before the second try
 * @param {(e) => boolean} [options.shouldRetry] override the retryable test
 * @param {(info) => void} [options.onRetry]   called before each wait, with
 *                                             `{ attempt, error, delayMs }`
 * @returns {Promise<T>} whatever `fn` resolves to
 * @throws the last error, once the attempts run out
 */
export const withRetry = async (
  fn,
  { attempts = DEFAULT_ATTEMPTS, backoffMs = DEFAULT_BACKOFF_MS, shouldRetry, onRetry } = {}
) => {
  const retryable = shouldRetry ?? isRetryable;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLast = attempt === attempts;
      if (isLast || !retryable(err)) throw err;

      const delayMs = backoffMs * 2 ** (attempt - 1);
      onRetry?.({ attempt, error: err, delayMs });
      await sleep(delayMs);
    }
  }

  // Unreachable: the loop either returns or throws. Kept so a future edit that
  // changes the loop bounds fails loudly instead of resolving undefined.
  throw lastError;
};

export default withRetry;
