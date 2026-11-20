/**
 * Sign in with Hive: one login for Hive and every app under
 * flyingdoublemranch.com.
 *
 * - Inside Hive (a frame), Hive hands this page a pass when asked.
 * - In its own tab on the shared domain, Hive's sign-in is in a cookie every
 *   app there can read; we use it to ask Hive for a pass ourselves.
 *
 * Either way the pass goes to the hiveExchange Cloud Function, which answers
 * with a sign-in for the KitchenHub account that has the same confirmed email.
 * All values here are public by design.
 */
import { signInWithCustomToken } from 'firebase/auth';

const HIVE_ORIGIN = 'https://hive.flyingdoublemranch.com';
const HIVE_ORIGINS = [HIVE_ORIGIN, 'https://fridge-board-7u23.netlify.app'];
const APP_ID = 'kitchenhub';
const SHARED_DOMAIN = 'flyingdoublemranch.com';
const SUPABASE_URL = 'https://fcjiummxpacwriwopcho.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S';
const FUNCTIONS_URL = (process.env.REACT_APP_FIREBASE_FUNCTIONS_URL || 'https://us-central1-mykitchenhub-db665.cloudfunctions.net').replace(/\/$/, '');

const inHive = () => typeof window !== 'undefined' && window.parent !== window;
const onSharedDomain = () => {
  const h = typeof window === 'undefined' ? '' : window.location.hostname;
  return h === SHARED_DOMAIN || h.endsWith(`.${SHARED_DOMAIN}`);
};

/** Inside Hive: ask for a pass and wait (briefly) for it. Null if Hive has nobody signed in. */
function passFromFrame(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const done = (v) => { window.removeEventListener('message', onMessage); clearTimeout(t); resolve(v); };
    const onMessage = (e) => {
      if (!HIVE_ORIGINS.includes(e.origin) || e.source !== window.parent) return;
      if (e.data?.type === 'hive:signed-out') done(null);
      if (e.data?.type === 'hive:pass' && typeof e.data.pass === 'string') done(e.data.pass);
    };
    const t = setTimeout(() => done(null), timeoutMs);
    window.addEventListener('message', onMessage);
    for (const o of HIVE_ORIGINS) window.parent.postMessage({ type: 'hive:hello', v: 1 }, o);
  });
}

/** In its own tab on the shared domain: read Hive's shared sign-in and ask Hive for a pass. */
async function passFromSharedSession() {
  const { createBrowserClient } = await import('@supabase/ssr');
  const sb = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: 'hive-auth', path: '/', sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 400, domain: `.${SHARED_DOMAIN}` },
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data } = await sb.auth.getSession(); // refreshes an expired session and saves it back for every app
  const token = data.session?.access_token;
  if (!token) return null;
  const res = await fetch(`${HIVE_ORIGIN}/api/hive/pass`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ app: APP_ID }),
  });
  if (!res.ok) return null;
  return (await res.json()).pass || null;
}

/**
 * Signs in with Hive if it can. Resolves to the Firebase user, or null when
 * Hive isn't signed in, this page isn't in Hive or on its domain, or there's
 * no KitchenHub account with that email (the normal login stays).
 */
export async function signInWithHive(auth) {
  if (!auth || auth.currentUser) return null;
  try {
    const pass = inHive() ? await passFromFrame() : onSharedDomain() ? await passFromSharedSession() : null;
    if (!pass) return null;
    const res = await fetch(`${FUNCTIONS_URL}/hiveExchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pass }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) return null;
    return (await signInWithCustomToken(auth, body.token)).user;
  } catch (err) {
    console.warn('[hive] sign-in failed:', err.message);
    return null;
  }
}
