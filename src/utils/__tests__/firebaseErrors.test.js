// src/utils/__tests__/firebaseErrors.test.js

import {
  friendlyError,
  authErrorMessage,
  errorCode,
  isRetryable,
  RETRYABLE_CODES,
  AUTH_ERROR_MESSAGES,
} from '../firebaseErrors';

/** Builds the shape the Firebase SDKs actually throw. */
const firebaseError = (code, message = `FirebaseError: [code=${code}]: something`) =>
  Object.assign(new Error(message), { code });

describe('errorCode', () => {
  it('reads the code off an error', () => {
    expect(errorCode(firebaseError('permission-denied'))).toBe('permission-denied');
  });

  it('accepts a bare code string', () => {
    expect(errorCode('storage/unauthorized')).toBe('storage/unauthorized');
  });

  it('is empty for an error with no code', () => {
    expect(errorCode(new Error('boom'))).toBe('');
    expect(errorCode(undefined)).toBe('');
  });
});

describe('friendlyError', () => {
  it.each([
    ['permission-denied', /permission/i],
    ['unavailable', /connection/i],
    ['deadline-exceeded', /too long/i],
    ['not-found', /find that/i],
    ['unauthenticated', /sign in again/i],
    ['resource-exhausted', /busy/i],
    ['failed-precondition', /refresh/i],
    ['invalid-argument', /check them/i],
  ])('explains Firestore %s in plain language', (code, expected) => {
    expect(friendlyError(firebaseError(code))).toMatch(expected);
  });

  it('handles the same codes when a callable Function prefixes them', () => {
    expect(friendlyError(firebaseError('functions/unavailable'))).toMatch(/connection/i);
    expect(friendlyError(firebaseError('functions/permission-denied'))).toMatch(/permission/i);
  });

  it('explains a storage rejection as a file problem, not a permissions bug', () => {
    const message = friendlyError(firebaseError('storage/unauthorized'));
    expect(message).toMatch(/JPEG/);
    expect(message).not.toMatch(/permission/i);
  });

  it('routes auth codes to the auth table', () => {
    expect(friendlyError(firebaseError('auth/wrong-password'))).toBe(
      AUTH_ERROR_MESSAGES['auth/wrong-password']
    );
  });

  it('names the action in the generic fallback', () => {
    expect(friendlyError(new Error('???'), { action: 'save that item' })).toBe(
      "We couldn't save that item. Please try again."
    );
  });

  it('prefers an explicit fallback over the generic template', () => {
    expect(friendlyError(new Error('???'), { fallback: 'Custom.' })).toBe('Custom.');
  });

  it('keeps a message a Cloud Function wrote for a person', () => {
    const err = Object.assign(new Error('That HelloFresh link is no longer live.'), {
      code: 'functions/whatever',
    });
    expect(friendlyError(err)).toBe('That HelloFresh link is no longer live.');
  });

  // The whole point of the module: none of these strings may reach a cook.
  it.each([
    'FirebaseError: [code=unavailable]: backend unreachable',
    'Missing or insufficient permissions.',
    'Function setDoc() called with invalid data at users/abc123/inventory',
    'firestore/internal assertion failed',
  ])('never passes SDK noise through: %s', (raw) => {
    const message = friendlyError(new Error(raw), { action: 'save that item' });
    expect(message).toBe("We couldn't save that item. Please try again.");
  });

  it('never returns an empty string', () => {
    expect(friendlyError(undefined)).toBeTruthy();
    expect(friendlyError(null)).toBeTruthy();
    expect(friendlyError({})).toBeTruthy();
  });
});

describe('authErrorMessage', () => {
  it('covers every code the sign-in form can produce', () => {
    Object.entries(AUTH_ERROR_MESSAGES).forEach(([code, expected]) => {
      expect(authErrorMessage(code)).toBe(expected);
    });
  });

  it('falls back for an unknown code', () => {
    expect(authErrorMessage('auth/brand-new')).toMatch(/unexpected error/i);
  });
});

describe('isRetryable', () => {
  it.each(RETRYABLE_CODES)('retries %s', (code) => {
    expect(isRetryable(firebaseError(code))).toBe(true);
  });

  it.each([
    'permission-denied',
    'invalid-argument',
    'not-found',
    'already-exists',
    'unauthenticated',
  ])('does not retry %s', (code) => {
    expect(isRetryable(firebaseError(code))).toBe(false);
  });

  it('retries a bare network failure from fetch, which carries no code', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryable(new Error('network timeout'))).toBe(true);
  });

  it('does not retry an ordinary programming error', () => {
    expect(isRetryable(new TypeError('x is not a function'))).toBe(false);
  });
});
