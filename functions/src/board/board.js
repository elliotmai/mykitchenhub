// functions/src/board/board.js
// `board` — a small token-protected HTTP API for Fridge Board, a kitchen kiosk
// that calls it server to server from a Netlify function.
//
//   GET  /                 today's board: meals, their recipes, expiring food,
//                          and the shopping list as KitchenHub shows it
//   POST /shopping         { name, section? } → add a typed item
//   POST /shopping/{id}    { bought: true|false } → tick a typed item off, or back
//
// Deployed URL: https://us-central1-mykitchenhub-db665.cloudfunctions.net/board
// (1st gen, default region — the same as every other HTTP function here).
//
// Auth is `Authorization: Bearer <token>`; see ./auth.js and
// docs/BOARD_API.md. This uses the admin SDK, so Firestore security rules do
// not apply: every read and write below is under users/{uid} for the one uid
// the token resolved to (plus reads of the shared `recipes` library), and
// nothing in a request can name a different user.
//
// No CORS headers on purpose. Nothing calls this from a browser, and a token
// that never sits in a page cannot leak from one.

const admin = require('firebase-admin');
const functions = require('firebase-functions');

const { HttpError, resolveUser } = require('./auth');
const { resolveTimeZone, todayIn } = require('./dates');
const { buildShoppingItem, buildShoppingList } = require('./shoppingList');
const {
  buildBoard,
  loadBoardSources,
  manualRow,
  boardWindow,
  derivedId,
  shoppingRows,
} = require('./boardData');

/** Longer than any real shopping line; refuses a body someone pasted by mistake. */
const MAX_NAME_LENGTH = 200;

/** `/`, `/shopping`, `/shopping/{id}` — with or without a trailing slash. */
const routeOf = (method, path) => {
  const segments = String(path || '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return null;
      }
    });
  if (segments.includes(null)) return null;

  if (method === 'GET' && segments.length === 0) return { name: 'board' };
  if (method === 'POST' && segments.length === 1 && segments[0] === 'shopping')
    return { name: 'add' };
  if (method === 'POST' && segments.length === 2 && segments[0] === 'shopping') {
    return { name: 'tick', id: segments[1] };
  }
  return null;
};

/** The JSON body, however the runtime handed it over. */
const parseBody = (body, rawBody) => {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  const text = Buffer.isBuffer(body)
    ? body.toString('utf8')
    : typeof body === 'string'
      ? body
      : rawBody?.toString('utf8');
  if (!text || !text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Body must be a JSON object.');
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const getBoard = async ({ db, uid, now, timeZone }) => {
  const sources = await loadBoardSources(db, uid, todayIn(timeZone, now));
  return buildBoard(sources, { now, timeZone });
};

/**
 * Add a typed item, exactly as the app's add box does — `buildShoppingItem`
 * plus a server timestamp (src/hooks/useShoppingList.js `addItem`).
 *
 * `section` is accepted and ignored. KitchenHub files every line by its name
 * (src/config/storeSections.js) and stores no aisle, so a section saved here
 * would be one the app never shows; the response says where it actually went.
 */
const addItem = async ({ db, uid, body }) => {
  const name = body.name;
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name is required.');
  if (name.trim().length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (body.section !== undefined && body.section !== null && typeof body.section !== 'string') {
    throw new HttpError(400, 'section must be a string.');
  }

  const document = buildShoppingItem({ name });
  const ref = await db
    .collection('users')
    .doc(uid)
    .collection('shoppingItems')
    .add({ ...document, createdAt: admin.firestore.FieldValue.serverTimestamp() });

  return { status: 200, body: { item: manualRow({ id: ref.id, ...document }) } };
};

/**
 * Tick a line off, or put it back.
 *
 * A typed item does what its checkbox does in the app (`setBought` in
 * src/hooks/useShoppingList.js): status `bought` with `boughtAt` stamped, or
 * back to `pending` with `boughtAt` cleared.
 *
 * A line derived from the week's meals does what its checkbox does in the app
 * (`setDerivedBought` in src/hooks/useMealPlan.js): its key is added to, or
 * removed from, `boughtKeys` on the week's mealPlans document, which is
 * created minimally if the week has none. An id not on this week's list is a
 * 404 like any other.
 */
const tickItem = async ({ db, uid, id, body, now, timeZone }) => {
  if (typeof body.bought !== 'boolean') throw new HttpError(400, 'bought must be true or false.');

  if (id.startsWith('item:')) {
    const docId = id.slice('item:'.length);
    if (!docId || docId.includes('/')) throw new HttpError(404, 'No such shopping item.');

    const ref = db.collection('users').doc(uid).collection('shoppingItems').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'No such shopping item.');

    await ref.update({
      status: body.bought ? 'bought' : 'pending',
      boughtAt: body.bought ? admin.firestore.FieldValue.serverTimestamp() : null,
    });
    return { status: 200, body: { ok: true } };
  }

  if (id.startsWith('meal:')) {
    const today = todayIn(timeZone, now);
    const { entries, inventory, manualItems, boughtKeys } = await loadBoardSources(db, uid, today, {
      recipes: false,
    });
    const { weekStart, weekEnd } = boardWindow(today);
    const weekEntries = entries.filter((entry) => entry.date >= weekStart && entry.date <= weekEnd);
    // Only a line the board actually shows can be ticked: one the kitchen
    // covers, or that a typed item stands in for, is a 404 like any unknown id.
    const shown = shoppingRows({
      manualItems,
      weekEntries,
      inventory,
      boughtKeys,
      today,
      timeZone,
    }).some((row) => row.id === id);
    const line =
      shown &&
      buildShoppingList(weekEntries, inventory, boughtKeys).find((item) => derivedId(item) === id);
    if (!line) throw new HttpError(404, 'No such shopping item.');

    const FieldValue = admin.firestore.FieldValue;
    const planRef = db.collection('users').doc(uid).collection('mealPlans').doc(weekStart);
    const planSnap = await planRef.get();
    if (planSnap.exists) {
      await planRef.update({
        boughtKeys: body.bought
          ? FieldValue.arrayUnion(line.key)
          : FieldValue.arrayRemove(line.key),
      });
    } else {
      await planRef.set({
        weekStart,
        source: 'manual',
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        boughtKeys: body.bought ? [line.key] : [],
      });
    }
    return { status: 200, body: { ok: true } };
  }

  throw new HttpError(404, 'No such shopping item.');
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * One request, start to finish, with everything injectable for the tests.
 *
 * @returns {Promise<{status: number, body: object}>}
 */
const handleBoardRequest = async ({
  db,
  method,
  path,
  headers = {},
  body,
  rawBody,
  now = new Date(),
}) => {
  try {
    // Authenticate before routing, so an unauthenticated caller learns nothing
    // about which paths exist.
    const { uid, profile } = await resolveUser(db, headers.authorization);
    const timeZone = resolveTimeZone(profile.timezone);

    const route = routeOf(String(method || '').toUpperCase(), path);
    if (!route) throw new HttpError(404, 'Not found.');

    if (route.name === 'board')
      return { status: 200, body: await getBoard({ db, uid, now, timeZone }) };

    const parsed = parseBody(body, rawBody);
    if (route.name === 'add') return await addItem({ db, uid, body: parsed });
    return await tickItem({ db, uid, id: route.id, body: parsed, now, timeZone });
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
    // The detail goes to the logs, never to the caller.
    console.error('board API error:', err);
    return { status: 500, body: { error: 'Internal error.' } };
  }
};

const board = functions.https.onRequest(async (req, res) => {
  const result = await handleBoardRequest({
    db: admin.firestore(),
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body,
    rawBody: req.rawBody,
  });
  res.set('Cache-Control', 'no-store');
  res.status(result.status).json(result.body);
});

module.exports = {
  MAX_NAME_LENGTH,
  routeOf,
  parseBody,
  handleBoardRequest,
  board,
};
