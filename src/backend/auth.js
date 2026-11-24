// src/backend/auth.js
// The Firebase Auth calls KitchenHub makes, answered by Supabase Auth: the one
// Hive sign-in shared by every app under flyingdoublemranch.com.
//
// A password Supabase does not know yet may be from before the move. Hive
// checks it against the old KitchenHub accounts and brings it over (the
// carry-over), and the sign-in is tried again, so nobody signs up twice.

import { HIVE_ORIGIN, forgetHousehold, supabase } from './supabase';

const AUTH = { kind: 'auth', currentUser: null };
export const getAuth = () => AUTH;

/** A Supabase user, shaped like the Firebase user the screens read. */
export function toUser(u) {
  if (!u) return null;
  const meta = u.user_metadata || {};
  return {
    uid: u.id,
    email: u.email || null,
    emailVerified: Boolean(u.email_confirmed_at),
    displayName: meta.display_name || meta.full_name || meta.name || null,
    photoURL: meta.avatar_url || null,
    metadata: { creationTime: u.created_at, lastSignInTime: u.last_sign_in_at },
    getIdToken: async () => (await supabase.auth.getSession()).data.session?.access_token || null,
  };
}

const CODES = {
  invalid_credentials: 'auth/invalid-credential',
  user_already_exists: 'auth/email-already-in-use',
  email_exists: 'auth/email-already-in-use',
  weak_password: 'auth/weak-password',
  email_address_invalid: 'auth/invalid-email',
  validation_failed: 'auth/invalid-email',
  over_request_rate_limit: 'auth/too-many-requests',
  over_email_send_rate_limit: 'auth/too-many-requests',
  email_not_confirmed: 'auth/email-not-confirmed',
  user_banned: 'auth/user-disabled',
  signup_disabled: 'auth/operation-not-allowed',
  reauthentication_needed: 'auth/requires-recent-login',
};

/** A Supabase auth error as the Firebase error the screens already explain. */
export function authError(err) {
  if (!err) return null;
  if (typeof err.code === 'string' && err.code.startsWith('auth/')) return err;
  const network =
    err.name === 'AuthRetryableFetchError' || /fetch|network/i.test(err.message || '');
  const code = network ? 'auth/network-request-failed' : CODES[err.code] || 'auth/internal-error';
  return Object.assign(new Error(err.message || code), { code });
}

const must = ({ data, error }) => {
  if (error) throw authError(error);
  return data;
};

export function onAuthStateChanged(_auth, next) {
  let last;
  const report = (session) => {
    const user = toUser(session?.user);
    AUTH.currentUser = user;
    const id = user ? `${user.uid}:${user.email}:${user.displayName}` : null;
    if (id === last) return;
    last = id;
    if (!user) forgetHousehold();
    next(user);
  };
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    // Out of the auth lock before the screens call back into Supabase.
    setTimeout(() => report(session), 0);
  });
  return () => data.subscription.unsubscribe();
}

async function carryOver(email, password) {
  const r = await fetch(`${HIVE_ORIGIN}/api/auth/carry-over`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);
  if (!r?.ok) return null;
  return r.json().catch(() => ({}));
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  email = String(email || '').trim();
  if (!password)
    throw Object.assign(new Error('auth/missing-password'), { code: 'auth/missing-password' });
  const first = await supabase.auth.signInWithPassword({ email, password });
  if (!first.error) return { user: toUser(first.data.user) };
  if (first.error.code !== 'invalid_credentials') throw authError(first.error);

  const d = await carryOver(email, password);
  if (!d) throw authError(first.error);
  if (d.how === 'email') {
    throw Object.assign(new Error('Check your email to finish signing in.'), {
      code: 'auth/carry-over-emailed',
    });
  }
  const again =
    d.how === 'token'
      ? await supabase.auth.verifyOtp({ token_hash: d.token, type: 'magiclink' })
      : await supabase.auth.signInWithPassword({ email, password });
  return { user: toUser(must(again).user) };
}

export async function createUserWithEmailAndPassword(_auth, email, password) {
  const data = must(
    await supabase.auth.signUp({
      email: String(email || '').trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
  );
  if (data.user && !data.user.identities?.length) throw authError({ code: 'user_already_exists' });
  if (!data.session) {
    throw Object.assign(new Error('Check your email to finish making your account.'), {
      code: 'auth/confirm-email',
    });
  }
  return { user: toUser(data.user) };
}

export async function signOut() {
  forgetHousehold();
  must(await supabase.auth.signOut());
}

/** The reset link opens Hive, which asks for the new password (one account, one place). */
export async function sendPasswordResetEmail(_auth, email) {
  must(
    await supabase.auth.resetPasswordForEmail(String(email || '').trim(), {
      redirectTo: `${HIVE_ORIGIN}/`,
    })
  );
}

export async function updateProfile(_user, { displayName } = {}) {
  if (displayName === undefined) return;
  must(await supabase.auth.updateUser({ data: { display_name: displayName } }));
}

export async function updateEmail(_user, email) {
  must(
    await supabase.auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/` })
  );
}

export async function updatePassword(_user, password) {
  must(await supabase.auth.updateUser({ password }));
}

export const EmailAuthProvider = {
  credential: (email, password) => ({ email, password }),
};

/** Checks the password again, as Firebase's re-authentication did. */
export async function reauthenticateWithCredential(user, { email, password }) {
  must(await supabase.auth.signInWithPassword({ email: email || user?.email, password }));
  return { user };
}
