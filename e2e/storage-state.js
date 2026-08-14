// e2e/storage-state.js
// Where the shared signed-in browser state lives.
//
// Its own module so playwright.config.js, auth.setup.js and the specs agree on
// the path without importing each other.

const path = require('path');

/** Saved by e2e/auth.setup.js, consumed by every authenticated project. */
const STORAGE_STATE = path.join(__dirname, '.auth', 'user.json');

/** Explicitly signed out — for specs that test the logged-out experience. */
const SIGNED_OUT_STATE = { cookies: [], origins: [] };

module.exports = { STORAGE_STATE, SIGNED_OUT_STATE };
