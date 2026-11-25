/*
 * Who is calling the board API (GET /api/board, POST /api/board/shopping…):
 *
 *   Authorization: Hive <pass>    Hive vouching for whoever is signed in to it
 *                                 (functions/src/board/hivePass.js); the pass
 *                                 names their Hive (Supabase) account.
 *   Authorization: Bearer <token> a token made under Settings → Connected apps,
 *                                 found by its SHA-256 in core.api_tokens.
 *
 * Either way the answer is that person and their own household's kitchen;
 * every failure is the same 401.
 */
import authModule from '../../functions/src/board/auth.js';
import passModule from '../../functions/src/board/hivePass.js';
import { kitchenFor, service } from './kitchen.mjs';

const { HttpError, MIN_TOKEN_LENGTH, bearerToken, hashToken } = authModule;
const { verifyHivePass } = passModule;

const UNAUTHORIZED = () => new HttpError(401, 'Unauthorized');

async function uidFromPass(pass) {
  const claims = verifyHivePass(pass);
  if (!claims || !claims.email || !claims.email_verified) return null;
  const { data, error } = await service().auth.admin.getUserById(claims.sub);
  const user = !error && data?.user;
  if (!user || String(user.email || '').toLowerCase() !== claims.email.toLowerCase()) return null;
  return user.id;
}

async function uidFromToken(token) {
  if (token.length < MIN_TOKEN_LENGTH) return null;
  const hash = hashToken(token);
  const tokens = service().schema('core').from('api_tokens');
  const { data, error } = await tokens
    .select('user_id, revoked_at')
    .eq('hash', hash)
    .eq('app', 'kitchenhub')
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  // Best-effort: never fails or delays the request.
  tokens
    .update({ last_used_at: new Date().toISOString() })
    .eq('hash', hash)
    .then(({ error: e }) => e && console.warn('board API: could not stamp last_used_at'));
  return data.user_id;
}

/** Authorization header → { uid, profile, db }, or a 401 HttpError. */
export async function authenticateBoard(authorization) {
  const header = String(authorization ?? '').trim();
  const hive = header.match(/^Hive\s+(\S+)$/i);
  const uid = hive ? await uidFromPass(hive[1]) : await uidFromToken(bearerToken(header));
  if (!uid) throw UNAUTHORIZED();
  const kitchen = await kitchenFor(uid);
  if (!kitchen) throw UNAUTHORIZED();
  const profile = await kitchen.db.doc('users', uid).get();
  return { uid, profile: profile.data() || {}, db: kitchen.db };
}

/** core.api_tokens for one person, as functions/src/apiTokens expects it. */
export const tokenStore = () => {
  const table = () => service().schema('core').from('api_tokens');
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    owned: async (uid) =>
      must(
        await table()
          .select('hash, label, created_at, last_used_at, revoked_at')
          .eq('user_id', uid)
          .eq('app', 'kitchenhub')
      ) || [],
    insert: async (row) => must(await table().insert({ ...row, app: 'kitchenhub' })),
    revoke: async (hash, at) =>
      must(await table().update({ revoked_at: at }).eq('hash', hash).eq('app', 'kitchenhub')),
  };
};
