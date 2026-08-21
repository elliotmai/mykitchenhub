// functions/src/alexa/handleSkillRequest.js
// What the skill actually does once the request is known to be genuine.
//
// This is the whole conversation:
//
//   "Alexa, tell My Kitchen Hub to add milk"      → AddItemIntent
//   "Alexa, ask My Kitchen Hub what's on my list" → ReadListIntent
//   "Alexa, tell My Kitchen Hub to remove milk"   → RemoveItemIntent
//
// The invocation name is not optional phrasing. Amazon turned off the List
// Skills API and the List Management REST API on 1 July 2024, so no skill can
// read or write Alexa's own shopping list any more — see docs/ALEXA_SKILL.md.
// This skill therefore owns its list rather than syncing one, and every
// utterance has to name it.
//
// Signature verification happens before any of this, in verifyRequest.js.

const { resolveAccessToken } = require('./accountLinking');
const { readList, addItem, removeItem } = require('./shoppingList');
const { describeList, linkAccount, say } = require('./speech');

const HELP_TEXT =
  'You can say: add milk to my list, remove milk from my list, or, what is on my shopping list?';

const LAUNCH_TEXT = 'Your kitchen is listening. You can add something to the shopping list, or ask what is on it.';

const LAUNCH_REPROMPT = 'Try saying: add milk to my list.';

/**
 * Pull a slot value, preferring what Alexa resolved it to over what it heard.
 *
 * The resolution is the canonical form from the skill's own slot type, so a
 * cook saying "tomatoes" and a cook saying "tomato" land on one row rather
 * than two — the same reason the app normalises names before matching.
 */
function slotValue(intent, name) {
  const slot = intent?.slots?.[name];
  if (!slot) return null;

  const resolved = slot.resolutions?.resolutionsPerAuthority?.find(
    (authority) => authority.status?.code === 'ER_SUCCESS_MATCH'
  );
  const canonical = resolved?.values?.[0]?.value?.name;

  const value = canonical || slot.value;
  return value ? String(value).trim() : null;
}

function numericSlot(intent, name) {
  const raw = slotValue(intent, name);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function handleAdd({ uid, intent, db, now, ops }) {
  const name = slotValue(intent, 'item');
  if (!name) {
    return say('What would you like me to add?', {
      endSession: false,
      reprompt: 'Say, for example: add milk.',
    });
  }

  const quantity = numericSlot(intent, 'quantity');
  const unit = slotValue(intent, 'unit') || '';

  const result = await ops.addItem({ uid, name, quantity, unit, db, now });

  if (result.duplicate) {
    return say(`${name} is already on your list.`, { endSession: false, reprompt: HELP_TEXT });
  }

  return say(`Added ${name} to your shopping list.`, {
    // Nobody adds one thing. Leaving the microphone open saves saying the
    // invocation name again for the second item.
    endSession: false,
    reprompt: 'What else?',
  });
}

async function handleRemove({ uid, intent, db, now, ops }) {
  const name = slotValue(intent, 'item');
  if (!name) {
    return say('What would you like me to remove?', {
      endSession: false,
      reprompt: 'Say, for example: remove milk.',
    });
  }

  const result = await ops.removeItem({ uid, name, db, now });

  if (result.removed) {
    return say(`Removed ${result.name} from your list.`, { endSession: false, reprompt: 'What else?' });
  }

  if (result.fromPlan) {
    return say(
      `${result.name} is on your list because a meal this week needs it. You can change that in the app.`
    );
  }

  return say(`I could not find ${name} on your list.`, { endSession: false, reprompt: HELP_TEXT });
}

async function handleRead({ uid, db, now, ops }) {
  const { items, total } = await ops.readList({ uid, db, now });
  return say(describeList(items, total));
}

/**
 * Route one verified request.
 *
 * @param {object} body        - the parsed Alexa request
 * @param {object} [options]
 * @param {object} [options.db]
 * @param {Date}   [options.now]
 * @param {object} [options.deps] - injected by the tests
 * @returns {Promise<object>} an Alexa response envelope
 */
async function handleSkillRequest(body, { db, now = new Date(), deps = {} } = {}) {
  const resolve = deps.resolveAccessToken || resolveAccessToken;
  const type = body?.request?.type;

  // Nothing to answer, and nothing to clean up: the session is already over.
  if (type === 'SessionEndedRequest') return { version: '1.0', response: {} };

  const accessToken =
    body?.context?.System?.user?.accessToken || body?.session?.user?.accessToken || null;

  const uid = await resolve({ accessToken, db, now: now.getTime ? now.getTime() : now });
  if (!uid) return linkAccount();

  if (type === 'LaunchRequest') {
    return say(LAUNCH_TEXT, { endSession: false, reprompt: LAUNCH_REPROMPT });
  }

  if (type !== 'IntentRequest') return say(HELP_TEXT);

  const intent = body.request.intent || {};
  const context = {
    uid,
    intent,
    db,
    now,
    ops: {
      addItem: deps.addItem || addItem,
      removeItem: deps.removeItem || removeItem,
      readList: deps.readList || readList,
    },
  };

  switch (intent.name) {
    case 'AddItemIntent':
      return handleAdd(context);
    case 'RemoveItemIntent':
      return handleRemove(context);
    case 'ReadListIntent':
      return handleRead(context);
    case 'AMAZON.HelpIntent':
      return say(HELP_TEXT, { endSession: false, reprompt: HELP_TEXT });
    case 'AMAZON.StopIntent':
    case 'AMAZON.CancelIntent':
    case 'AMAZON.NavigateHomeIntent':
      return say('Goodbye.');
    case 'AMAZON.FallbackIntent':
    default:
      return say(`Sorry, I did not catch that. ${HELP_TEXT}`, {
        endSession: false,
        reprompt: HELP_TEXT,
      });
  }
}

module.exports = {
  HELP_TEXT,
  LAUNCH_TEXT,
  slotValue,
  numericSlot,
  handleSkillRequest,
};
