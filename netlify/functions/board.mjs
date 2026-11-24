/*
 * The board API Hive's fridge board reads (Fridge-Board netlify/functions/board.mjs):
 *   GET  /api/board                 today's meals, recipes, use-soon and shopping
 *   POST /api/board/shopping        { name } → add a typed item
 *   POST /api/board/shopping/{id}   { bought } → tick it off, or back
 * Routes and answers are functions/src/board/board.js; who is calling is
 * ../lib/kitchenAuth.mjs. Server to server: no CORS on purpose.
 */
import boardModule from '../../functions/src/board/board.js';
import { authenticateBoard } from '../lib/kitchenAuth.mjs';

const { handleBoardRequest } = boardModule;

export default async (req) => {
  const url = new URL(req.url);
  const text = req.method === 'GET' ? '' : await req.text();
  const result = await handleBoardRequest({
    db: null,
    method: req.method,
    path: url.pathname.replace(/^\/api\/board/, '') || '/',
    headers: { authorization: req.headers.get('authorization') || '' },
    body: undefined,
    rawBody: Buffer.from(text),
    authenticate: authenticateBoard,
  });
  return Response.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } });
};

export const config = { path: ['/api/board', '/api/board/*'] };
