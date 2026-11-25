/*
 * POST /api/farm/eggs — Galaxy Farm keeping the kitchen's Eggs in step with
 * the eggs collected, given away and sold on the farm. Server to server: no
 * CORS on purpose.
 *
 *   Authorization: Bearer khapp_…   a token made under Settings → Connected
 *                                   apps (the same tokens as the board API,
 *                                   ../lib/kitchenAuth.mjs). The household is
 *                                   the token owner's; nothing in the body
 *                                   can name another.
 *
 *   { timeZone?: "America/Chicago",
 *     records: [{ id, type: "log" | "disposition", version: ISO timestamp,
 *                 date: "YYYY-MM-DD", quantity, kind?: "kept"|"given"|"sold",
 *                 deleted?: boolean }] }      (at most 200)
 *
 *   → { ok: true, item: { id, quantity } | null, created, applied: [id],
 *       unchanged: [id], ignored: [{ id, reason }], rejected: [{ id, reason }] }
 *
 * Each record is the farm record as it is now; resending one is harmless
 * (functions/src/farm/farmEggs.js). Only the Eggs inventory item is written.
 */
import farmModule from '../../functions/src/farm/farmEggs.js';
import { authenticateBoard } from '../lib/kitchenAuth.mjs';
import { applyEggsBatch } from '../lib/farmEggsStore.mjs';

const { FarmEggsError, dayIn, parseBatch } = farmModule;

const reply = (status, body) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const validZone = (zone) => {
  if (typeof zone !== 'string' || !zone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
};

export default async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  let who;
  try {
    who = await authenticateBoard(req.headers.get('authorization') || '');
  } catch {
    return reply(401, { error: 'Unauthorized' });
  }

  const body = await req.json().catch(() => null);
  try {
    const { records, rejected } = parseBatch(body);
    const now = new Date();
    const today = dayIn(now, validZone(body?.timeZone));
    const result = records.length
      ? await applyEggsBatch({ householdId: who.db.householdId, records, now, today })
      : { itemId: null, quantity: 0, created: false, applied: [], unchanged: [], ignored: [] };
    return reply(200, {
      ok: true,
      item: result.itemId ? { id: result.itemId, quantity: result.quantity } : null,
      created: result.created,
      applied: result.applied,
      unchanged: result.unchanged,
      ignored: result.ignored,
      rejected,
    });
  } catch (err) {
    if (err instanceof FarmEggsError) return reply(err.status, { error: err.message });
    console.error('farm eggs failed:', err.message);
    return reply(500, { error: 'Internal error.' });
  }
};

export const config = { path: '/api/farm/eggs' };
