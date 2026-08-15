// e2e/storage-state.js
// The signed-out browser state.
//
// There is no longer a single shared signed-in state file here: each worker
// captures its own, for its own account, in the storageState fixture in
// e2e/fixtures.js. See e2e/accounts.js for why.

/** Explicitly signed out — for specs that test the logged-out experience. */
const SIGNED_OUT_STATE = { cookies: [], origins: [] };

module.exports = { SIGNED_OUT_STATE };
