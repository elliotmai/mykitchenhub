// src/test-utils/humanErrors.js
// The shared assertion behind roadmap 9.3's "never a raw Firebase code".
//
// Before Phase 9 a hook's catch block ended `return { error: err.message }`, so
// what reached the screen was whatever the SDK happened to say — "Missing or
// insufficient permissions.", "FirebaseError: [code=unavailable]", a Firestore
// document path. Each suite pinned its own literal, which meant the rule was
// only as good as whoever wrote the next test remembering it.
//
// This states the rule once, so a hook that regresses fails wherever it is
// tested rather than only where someone thought to look.

/**
 * Patterns that mean the string came from the SDK rather than from a person.
 * Each is something that actually appeared on screen before this phase.
 */
const SDK_NOISE = [
  /FirebaseError/i,
  /\[code=/,
  /\bfirestore\b/i,
  /\bfirebase\b/i,
  /Missing or insufficient/i,
  /users\/[A-Za-z0-9_-]+\//, // a document path
  /permission-denied|failed-precondition|deadline-exceeded|resource-exhausted/,
  /storage\/[a-z-]+/,
  /auth\/[a-z-]+/,
];

/**
 * Asserts `message` is something a cook could read and act on.
 *
 * @param {string} message  what the hook or page put in front of the user
 * @param {RegExp} [about]  optional: the subject it should name, so the test
 *                          still pins *which* failure was described
 */
export const expectHumanError = (message, about) => {
  expect(typeof message).toBe('string');
  expect(message.trim().length).toBeGreaterThan(0);

  SDK_NOISE.forEach((pattern) => {
    expect(message).not.toMatch(pattern);
  });

  // Something a person wrote ends in a sentence, not a bare code fragment.
  expect(message).toMatch(/[.!?]$/);

  if (about) expect(message).toMatch(about);
};

export default expectHumanError;
