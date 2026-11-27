// src/backend/supabase.js
// KitchenHub lives in Hive's Supabase project (schema `kitchen`), so it shares
// one sign-in with Hive and every app under flyingdoublemranch.com: the
// session is a cookie for the whole domain, the same as Hive's. Both values
// below are public by design; row-level security decides who reads what.

import { createBrowserClient } from '@supabase/ssr';

//
// The end-to-end build points all three at a local Supabase stack instead
// (build:e2e in package.json, e2e/supabase/); a normal build leaves them unset.
export const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL || 'https://fcjiummxpacwriwopcho.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S';
export const HIVE_ORIGIN =
  process.env.REACT_APP_HIVE_ORIGIN || 'https://hive.flyingdoublemranch.com';

const SHARED_DOMAIN = 'flyingdoublemranch.com';
const host = typeof window === 'undefined' ? '' : window.location.hostname;
const shared = host === SHARED_DOMAIN || host.endsWith(`.${SHARED_DOMAIN}`);

export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  cookieOptions: {
    name: 'hive-auth',
    path: '/',
    sameSite: 'lax',
    secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 400,
    ...(shared ? { domain: `.${SHARED_DOMAIN}` } : {}),
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

export const kitchen = supabase.schema('kitchen');
export const core = supabase.schema('core');

let household = null;
let householdFor = null;

// A kitchen shared with me (as an event partner or guest) can be the one the
// app works in; the database decides what of it I may see.
const ACTIVE_KEY = 'kitchenhub.activeKitchen';
let active = null;
try {
  active = JSON.parse(window.localStorage.getItem(ACTIVE_KEY) || 'null');
} catch {
  active = null;
}

/** The shared kitchen the app is working in, or null for my own household. */
export const activeKitchen = () => active;

/** Work in a shared kitchen ({ household_id, household, kind, event_id, can_edit }), or null for mine. */
export function setActiveKitchen(share) {
  active = share && share.household_id ? share : null;
  try {
    if (active) window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* private window: fine for this visit */
  }
}

/**
 * The household this kitchen belongs to (Hive's core.households). Someone
 * with none yet makes one or joins one with a code first
 * (components/Auth/HouseholdGate.jsx); `create` makes one on the spot.
 */
export async function myHousehold({ create = false } = {}) {
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user?.id || null;
  if (!uid) throw Object.assign(new Error('Sign in first.'), { code: 'permission-denied' });
  if (active?.household_id) return active.household_id;
  if (household && householdFor === uid) return household;
  const { data, error } = await core.rpc('my_household');
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  let hid = data;
  if (!hid && create) {
    const made = await core.rpc('create_household', { name: 'Kitchen' });
    if (made.error) throw Object.assign(new Error(made.error.message), { code: made.error.code });
    hid = made.data;
  }
  if (!hid)
    throw Object.assign(new Error('Join or make a household first.'), {
      code: 'permission-denied',
    });
  household = hid;
  householdFor = uid;
  return hid;
}

/** Forget the cached household (signing out, or tests). */
export const forgetHousehold = () => {
  household = null;
  householdFor = null;
};

/** My own household's id, ignoring a shared kitchen I'm working in (null if none). */
export async function ownHousehold() {
  const { data, error } = await core.rpc('my_household');
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data || null;
}

/** The signed-in person's access token, for KitchenHub's own server functions. */
export async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}
