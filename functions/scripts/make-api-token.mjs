#!/usr/bin/env node
/*
 * LEGACY. New tokens for the `board` Cloud Function come from the app:
 * Settings → Connected apps mints one (khapp_…), shows it once, stores only its
 * hash in apiTokens/{sha256}, and revokes it with one tap. Use that.
 *
 * This script is kept for the hand-made tokens that predate the screen: it
 * prints a token and the SHA-256 hash to put on your Firestore user document,
 * and those `apiTokenHash` / `apiTokenHashes` fields still work.
 *
 *   node functions/scripts/make-api-token.mjs
 *
 * 1. Keep the token somewhere private (a password manager, or the Fridge Board
 *    Netlify environment). It is shown once and is never stored anywhere in
 *    plain text.
 * 2. In the Firebase console → Firestore → users → <your user id>, add the hash
 *    to the array field  apiTokenHashes  (create it as an array if it is not
 *    there — one entry per connected app, so each can be revoked on its own).
 *    A single string field  apiTokenHash  works too.
 * 3. Optionally set the string field  timezone  (an IANA name such as
 *    "America/Chicago") on the same document; it decides what "today" means.
 *    Without it the API uses America/Chicago.
 *
 * To revoke a token, delete its array entry or field. The app cannot write
 * these fields — the security rules refuse it — so only the console (or the
 * admin SDK) can grant or revoke access.
 */
import { randomBytes, createHash } from 'node:crypto';

const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');

console.log(`\nAPI token (keep private, shown once):\n  ${token}\n`);
console.log(
  `Hash (add to the apiTokenHashes array, or set as apiTokenHash, on users/<your uid>):\n  ${hash}\n`
);
