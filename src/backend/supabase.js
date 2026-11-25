// src/backend/supabase.js
// KitchenHub lives in Hive's Supabase project (schema `kitchen`), so it shares
// one sign-in with Hive and every app under flyingdoublemranch.com: the
// session is a cookie for the whole domain, the same as Hive's. Both values
// below are public by design; row-level security decides who reads what.

import { createBrowserClient } from '@supabase/ssr';

export const SUPABASE_URL = 'https://fcjiummxpacwriwopcho.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S';
export const HIVE_ORIGIN = 'https://hive.flyingdoublemranch.com';

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

/**
 * The household this kitchen belongs to (Hive's core.households). Someone
 * with none yet makes one or joins one with a code first
 * (components/Auth/HouseholdGate.jsx); `create` makes one on the spot.
 */
export async function myHousehold({ create = false } = {}) {
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user?.id || null;
  if (!uid) throw Object.assign(new Error('Sign in first.'), { code: 'permission-denied' });
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

/** The signed-in person's access token, for KitchenHub's own server functions. */
export async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}
