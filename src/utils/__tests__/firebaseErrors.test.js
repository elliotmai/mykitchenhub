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

  // ---------------------------------------------------------------------------
  // The pass-through, and what it must not let past
  //
  // An unrecognised code with a message attached is shown verbatim, on the
  // grounds that a callable Function wrote it for a person to read. That is the
  // one door in this module a raw string can reach a cook through, so anything
  // that is not curated copy has to be caught on the way.
  // ---------------------------------------------------------------------------
  it.each([
    [
      'a stack frame',
      'Cannot read properties of undefined\n    at handleSubmit (main.a1b2c3.js:2:14567)',
    ],
    ['a bundled stack line', 'boom at Object.dispatch (bundle.js:1:2)'],
    ['a backend URL', 'POST https://us-central1-mykitchenhub.cloudfunctions.net/import failed'],
    ['an emulator URL', 'request to http://127.0.0.1:5001/mykitchenhub-e2e/us-central1/x failed'],
    ['an account id', 'User aB3xQ9zK2mNpL7vRt4Ws is not allowed to do that'],
    ['a bare uid on its own', 'owner mismatch: 8f3kQzR1pLmN7vXtY2wB4cD6eF0g'],
  ])('does not pass %s through, even with a code attached', (_label, raw) => {
    const err = Object.assign(new Error(raw), { code: 'functions/some-code' });

    expect(friendlyError(err, { action: 'save that item' })).toBe(
      "We couldn't save that item. Please try again."
    );
  });

  it('still lets a sentence a Cloud Function wrote for a person through', () => {
    // The guard above must not be so keen that it swallows the copy it exists
    // to protect.
    [
      'That HelloFresh link is no longer live.',
      'We could not read the recipe card in that photo. Try a straighter shot.',
      'That recipe is already in your library.',
    ].forEach((raw) => {
      const err = Object.assign(new Error(raw), { code: 'functions/recipe-not-found' });
      expect(friendlyError(err)).toBe(raw);
    });
  });

  // ---------------------------------------------------------------------------
  // Codes that collide with Object.prototype
  //
  // Every table here is a plain object literal, so a bracket lookup on a key
  // like `constructor` reaches the prototype and finds a *function* — truthy,
  // and returned as the message to render. friendlyError also accepts a bare
  // code string, so the value did not have to come from a Firebase error to
  // get there.
  // ---------------------------------------------------------------------------
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'returns a sentence, not a function, for the code %s',
    (code) => {
      // No message on the error, so nothing legitimate can be passed through
      // and the generic template is the only correct answer. Before the own
      // property guard this returned `function Object() { [native code] }`.
      const message = friendlyError(Object.assign(new Error(''), { code }), {
        action: 'save that item',
      });

      expect(typeof message).toBe('string');
      expect(message).not.toMatch(/native code|function\s/);
      expect(message).toBe("We couldn't save that item. Please try again.");
    }
  );

  it.each(['constructor', 'toString', 'valueOf'])(
    'does the same when %s arrives as a bare code string',
    (code) => {
      expect(typeof friendlyError(code)).toBe('string');
      expect(typeof authErrorMessage(code)).toBe('string');
      expect(authErrorMessage(code)).toMatch(/unexpected error/i);
    }
  );
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
