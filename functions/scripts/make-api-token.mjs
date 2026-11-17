#!/usr/bin/env node
/*
 * Generates a personal API token for the `board` Cloud Function
 * (functions/src/board/) and prints the SHA-256 hash to store on your
 * Firestore user document.
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
