// e2e/supabase-admin.js
// The test process's own way into the local Supabase stack (e2e/supabase/),
// as the service role: it seeds accounts, writes fixtures and reads back what
// the app stored, past row-level security.
//
// The browser never sees any of this. It signs in as a cook with the anon key,
// like everyone else, so the policies it is held to are the real ones.
//
// The keys are the Supabase CLI's fixed local demo keys: the same on every
// machine, good only for a stack on 127.0.0.1, and printed by
// `npx supabase status --workdir e2e`. Override with the env vars below to
// point the suite somewhere else.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/**
 * Stands in for the Realtime transport, which the test process never uses.
 * supabase-js otherwise looks for a global WebSocket when a client is made,
 * and Node 20 (CI) has none.
 */
class NoRealtime {
  constructor() {
    throw new Error('e2e/supabase-admin.js does not use Realtime');
  }
}

const NO_SESSION = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: NoRealtime },
};

/** Service role: bypasses row-level security. Test process only. */
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, NO_SESSION);
const kitchen = admin.schema('kitchen');
const core = admin.schema('core');

/** A client signed in as nobody yet, for doing something the way a cook would. */
const anonClient = () => createClient(SUPABASE_URL, ANON_KEY, NO_SESSION);

/** Throws a Supabase error with the step that hit it, or hands back the data. */
const must = (step, { data, error }) => {
  if (error) throw new Error(`${step}: ${error.message || JSON.stringify(error)}`);
  return data;
};

// ---------------------------------------------------------------------------
// Dates. The app stores a date inside kitchen.docs.data as {"$ts": ms}
// (src/backend/timestamp.js). Reads come back as a Timestamp with the methods
// the specs already call (toDate, toMillis, seconds).
// ---------------------------------------------------------------------------

class Timestamp {
  constructor(ms) {
    this._ms = Math.round(Number(ms));
    this.seconds = Math.floor(this._ms / 1000);
  }

  static now() {
    return new Timestamp(Date.now());
  }

  static fromDate(date) {
    return new Timestamp(new Date(date).getTime());
  }

  toDate() {
    return new Date(this._ms);
  }

  toMillis() {
    return this._ms;
  }

  toJSON() {
    return { $ts: this._ms };
  }
}

const isPlain = (v) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;

/** Dates and Timestamps → {"$ts"}, all the way down; undefined fields dropped. */
const encode = (value) => {
  if (value instanceof Timestamp) return { $ts: value.toMillis() };
  if (value instanceof Date) return { $ts: value.getTime() };
  if (Array.isArray(value)) return value.map(encode);
  if (isPlain(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = encode(v);
    return out;
  }
  return value;
};

/** {"$ts"} → Timestamp, all the way down. */
const decode = (value) => {
  if (Array.isArray(value)) return value.map(decode);
  if (isPlain(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$ts' && typeof value.$ts === 'number') {
      return new Timestamp(value.$ts);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
};

/** A 20-character id, like the ones the app makes (docModel.autoId). */
const autoId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 20; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** Every auth user, by email (lower-cased). */
const usersByEmail = async () => {
  const out = new Map();
  for (let page = 1; ; page += 1) {
    const { users } = must('list users', await admin.auth.admin.listUsers({ page, perPage: 1000 }));
    for (const u of users) out.set(String(u.email).toLowerCase(), u);
    if (users.length < 1000) return out;
  }
};

/** The user id for an email, or null. */
const userIdFor = async (email) =>
  (await usersByEmail()).get(String(email).toLowerCase())?.id || null;

/** The household a user belongs to, or null. */
const householdOf = async (uid) => {
  const rows = must(
    'read membership',
    await core.from('household_members').select('household_id').eq('user_id', uid).limit(1)
  );
  return rows[0]?.household_id || null;
};

/**
 * Removes an account and everything it made: its households go first, which
 * takes their kitchen.docs, timers and sharing rows with them (ON DELETE
 * CASCADE), then the user.
 */
const deleteAccount = async (uid) => {
  must('delete households', await core.from('households').delete().eq('created_by', uid));
  must('delete user', await admin.auth.admin.deleteUser(uid));
};

/**
 * Makes a confirmed account with a household of its own, the way a cook gets
 * one: signed in, through core.create_household. Returns { uid, hid }.
 */
const createAccount = async ({ email, password, displayName }) => {
  const { user } = must(
    `create ${email}`,
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })
  );

  const cook = anonClient();
  must(`sign in ${email}`, await cook.auth.signInWithPassword({ email, password }));
  const hid = must(
    `make household for ${email}`,
    await cook.schema('core').rpc('create_household', { name: `${displayName}'s kitchen` })
  );
  await cook.auth.signOut();

  return { uid: user.id, hid };
};

// ---------------------------------------------------------------------------
// kitchen.docs
// ---------------------------------------------------------------------------

/** Collections under users/{uid}/ that belong to the household (docModel.js). */
const HOUSEHOLD_COLLECTIONS = [
  'storageLocations',
  'inventory',
  'importHistory',
  'deliveries',
  'shoppingItems',
  'mealPlanEntries',
  'mealPlans',
];

/**
 * The path a row is stored under, from the path the screens use:
 * users/<uid>/inventory/x → inventory/x (docModel.storedPath).
 */
const storedPath = (path) => {
  const parts = String(path).split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'users' && HOUSEHOLD_COLLECTIONS.includes(parts[2])) {
    return parts.slice(2).join('/');
  }
  return parts.join('/');
};

/** Writes (replaces) one document. */
const putDoc = async (hid, path, data) => {
  must(
    `write ${path}`,
    await kitchen.from('docs').upsert(
      {
        household_id: hid,
        path: storedPath(path),
        data: encode(data),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'household_id,path' }
    )
  );
};

/** Reads one document as { id, ...fields }, or undefined. */
const getDoc = async (hid, path) => {
  const row = must(
    `read ${path}`,
    await kitchen
      .from('docs')
      .select('path, data')
      .eq('household_id', hid)
      .eq('path', storedPath(path))
      .maybeSingle()
  );
  return row ? { id: row.path.split('/').pop(), ...decode(row.data) } : undefined;
};

/** Every document directly in a collection, as [{ id, ...fields }]. */
const listDocs = async (hid, collectionPath) => {
  const rows = must(
    `list ${collectionPath}`,
    await kitchen
      .from('docs')
      .select('path, data')
      .eq('household_id', hid)
      .eq('parent', storedPath(collectionPath))
  );
  return rows.map((r) => ({ id: r.path.split('/').pop(), ...decode(r.data) }));
};

/** Deletes one document. */
const deleteDoc = async (hid, path) => {
  must(
    `delete ${path}`,
    await kitchen.from('docs').delete().eq('household_id', hid).eq('path', storedPath(path))
  );
};

module.exports = {
  SUPABASE_URL,
  ANON_KEY,
  admin,
  kitchen,
  core,
  must,
  Timestamp,
  encode,
  decode,
  autoId,
  usersByEmail,
  userIdFor,
  householdOf,
  createAccount,
  deleteAccount,
  storedPath,
  putDoc,
  getDoc,
  listDocs,
  deleteDoc,
};
