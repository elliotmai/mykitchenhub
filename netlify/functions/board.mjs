/*
 * The board API Hive's fridge board reads (Fridge-Board netlify/functions/board.mjs):
 *   GET  /api/board                 today's meals, recipes, use-soon and shopping
 *   POST /api/board/shopping        { name } → add a typed item
 *   POST /api/board/shopping/{id}   { bought } → tick it off, or back
 *   GET  /api/board/timers          the household's cooking timers
 *   POST /api/board/timers          { label, minutes, key? } → start one
 *   POST /api/board/timers/{id}     { stop: true } → stop (or silence) one
 * Routes and answers are functions/src/board/board.js (timers: below); who is
 * calling is ../lib/kitchenAuth.mjs. Server to server: no CORS on purpose.
 */
import boardModule from '../../functions/src/board/board.js';
import { authenticateBoard } from '../lib/kitchenAuth.mjs';
import { service } from '../lib/kitchen.mjs';
import { fromRow, newTimerRow } from '../../src/timers/timerLogic.js';

const { handleBoardRequest } = boardModule;

const reply = (status, body) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** The timers routes, for the caller's own household only. */
async function timers(req, rest) {
  let who;
  try {
    who = await authenticateBoard(req.headers.get('authorization') || '');
  } catch {
    return reply(401, { error: 'Unauthorized' });
  }
  const table = () => service().schema('kitchen').from('timers');
  const hid = who.db.householdId;
  const list = async () => {
    const { data, error } = await table()
      .select('id, key, label, duration_s, ends_at')
      .eq('household_id', hid)
      .order('ends_at');
    if (error) throw new Error(error.message);
    return (data || []).map(fromRow);
  };

  if (req.method === 'GET' && !rest) return reply(200, { timers: await list() });
  if (req.method !== 'POST') return reply(404, { error: 'Not found.' });
  const body = await req.json().catch(() => ({}));

  if (!rest) {
    const row = newTimerRow({
      label: body.label,
      minutes: body.minutes,
      seconds: body.seconds,
      key: body.key,
    });
    if (!row) return reply(400, { error: 'minutes must be between a second and a day.' });
    const { data, error } = await table()
      .insert({ ...row, household_id: hid, created_by: who.uid })
      .select('id, key, label, duration_s, ends_at')
      .single();
    if (error) throw new Error(error.message);
    return reply(200, { timer: fromRow(data) });
  }
  if (body.stop !== true) return reply(400, { error: 'stop must be true.' });
  const { error } = await table()
    .delete()
    .eq('household_id', hid)
    .eq('id', decodeURIComponent(rest));
  if (error) return reply(404, { error: 'No such timer.' });
  return reply(200, { ok: true });
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/board/, '') || '/';
  const timerRoute = path.match(/^\/timers(?:\/([^/]+))?\/?$/);
  if (timerRoute) {
    try {
      return await timers(req, timerRoute[1]);
    } catch (err) {
      console.error('board timers failed:', err.message);
      return reply(500, { error: 'Internal error.' });
    }
  }

  const text = req.method === 'GET' ? '' : await req.text();
  const result = await handleBoardRequest({
    db: null,
    method: req.method,
    path,
    headers: { authorization: req.headers.get('authorization') || '' },
    body: undefined,
    rawBody: Buffer.from(text),
    authenticate: authenticateBoard,
  });
  return reply(result.status, result.body);
};

export const config = { path: ['/api/board', '/api/board/*'] };
