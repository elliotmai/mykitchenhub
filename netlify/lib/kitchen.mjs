/*
 * What every KitchenHub server function shares: Hive's Supabase project with
 * the service role (SUPABASE_SERVICE_ROLE_KEY, this site's environment), who
 * is calling, and that person's household kitchen.
 *
 * The service role passes row-level security, so the household is always
 * worked out here from the caller's own sign-in and handed to makeServerDb;
 * nothing in a request body can name a different one.
 */
import { createClient } from '@supabase/supabase-js';
import { makeServerDb } from '../../src/backend/serverDb.js';

export const env = (key, fallback = undefined) => {
  const v = globalThis.Netlify?.env?.get?.(key) ?? process.env[key];
  return v === undefined || v === '' ? fallback : v;
};

const SUPABASE_URL = () => env('SUPABASE_URL', 'https://fcjiummxpacwriwopcho.supabase.co');

let client = null;
/** Supabase as the service role. Throws a readable reason when unset. */
export function service() {
  if (client) return client;
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw Object.assign(new Error('SUPABASE_SERVICE_ROLE_KEY is not set'), { unconfigured: true });
  client = createClient(SUPABASE_URL(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** The household a person cooks in (the one they joined first), or null. */
export async function householdOf(uid) {
  const { data, error } = await service()
    .schema('core')
    .from('household_members')
    .select('household_id, joined_at')
    .eq('user_id', uid)
    .order('joined_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.household_id ?? null;
}

/** That person's household kitchen, or null when they have no household. */
export async function kitchenFor(uid) {
  const householdId = await householdOf(uid);
  if (!householdId) return null;
  return { householdId, db: makeServerDb({ client: service(), householdId }) };
}

/** The household's Let's Eat recipes, read-only, for the legacy sync. */
export const letsEatFor = (householdId) =>
  makeServerDb({ client: service(), householdId, schema: 'letseat', readOnly: true });

/** The signed-in person behind `Authorization: Bearer <Supabase access token>`, or null. */
export async function signedIn(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token.split('.').length !== 3) return null;
  const { data, error } = await service().auth.getUser(token);
  if (error || !data?.user) return null;
  const kitchen = await kitchenFor(data.user.id);
  return { uid: data.user.id, email: data.user.email || null, ...(kitchen || { householdId: null, db: null }) };
}

export const json = (status, body, headers = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

const HTTP = {
  'invalid-argument': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'failed-precondition': 412,
  internal: 500,
};

/**
 * A callable, the way httpsCallable (src/backend/functions.js) calls it:
 * POST { data } with the person's token → { result } or { error: { status, message } }.
 */
export function callable(run, { needsKitchen = true } = {}) {
  return async (req) => {
    if (req.method !== 'POST') return json(405, { error: { status: 'invalid-argument', message: 'Use POST.' } });
    let who;
    try {
      who = await signedIn(req);
    } catch (err) {
      console.error('callable: could not check the sign-in:', err.message);
      return json(500, { error: { status: 'internal', message: 'Something went wrong.' } });
    }
    if (!who) return json(401, { error: { status: 'unauthenticated', message: 'Sign in first.' } });
    if (needsKitchen && !who.db) {
      return json(412, { error: { status: 'failed-precondition', message: 'Join or make a household first.' } });
    }
    const body = await req.json().catch(() => ({}));
    try {
      return json(200, { result: (await run({ ...who, data: body?.data ?? {} })) ?? null });
    } catch (err) {
      const status = typeof err.status === 'string' && HTTP[err.status] ? err.status : 'internal';
      if (status === 'internal') console.error('callable failed:', err.message);
      const message = typeof err.status === 'string' ? err.message : 'Something went wrong.';
      return json(HTTP[status], { error: { status, message } });
    }
  };
}

/**
 * Run an Express-style (req, res) handler from functions/src on a web
 * Request, and answer with what it wrote.
 */
export async function expressish(handler, req, extra = {}) {
  const text = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  const headers = Object.fromEntries([...req.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  const out = { status: 200, headers: {}, body: undefined, json: false };
  const res = {
    set: (k, v) => ((out.headers[k] = v), res),
    status: (s) => ((out.status = s), res),
    json: (b) => ((out.body = b), (out.json = true), res),
    send: (b) => ((out.body = b), res),
  };
  await handler({ method: req.method, headers, body, rawBody: Buffer.from(text || ''), path: new URL(req.url).pathname, ...extra }, res);
  if (out.json) return Response.json(out.body, { status: out.status, headers: out.headers });
  return new Response(out.body ?? '', { status: out.status, headers: out.headers });
}
