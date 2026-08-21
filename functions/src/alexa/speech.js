// functions/src/alexa/speech.js
// Turning shopping list rows into something worth hearing, and into the JSON
// envelope Alexa expects back.
//
// A list read aloud is not a list rendered: "milk, 1, " is a bad sentence, and
// twenty items in a row is not something anybody listens to. Quantities are
// only spoken when they say something ("2 litres of milk" is worth hearing,
// "1 milk" is not), and a long list is cut short with a count of the rest.

const { SPOKEN_LIMIT } = require('./shoppingList');

/** Alexa's own TTS reads bare digits naturally, so numbers stay as numbers. */
function spokenItem(item) {
  const name = String(item?.name ?? '').trim();
  const unit = String(item?.unit ?? '').trim();
  const quantity = Number(item?.quantity);

  if (!Number.isFinite(quantity) || quantity <= 0) return name;
  // "1 milk" is how a database says it, not a person. One of something is just
  // the thing itself — unless it is one of a measure, where "1 litre of milk"
  // is exactly what somebody would say.
  if (quantity === 1 && !unit) return name;
  if (!unit) return `${quantity} ${name}`;

  return `${quantity} ${unit} of ${name}`;
}

/** "milk, bread and 2 kg of potatoes" — an Oxford comma is not spoken. */
function joinSpoken(parts) {
  const list = parts.filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The whole "what's on my list" sentence.
 *
 * @param {array}  items - already truncated to what will be read out
 * @param {number} total - how many there are in all, truncation included
 */
function describeList(items = [], total = items.length) {
  if (total === 0) return 'Your shopping list is empty.';

  const spoken = joinSpoken(items.map(spokenItem));
  const hidden = total - items.length;

  if (hidden > 0) {
    const head =
      items.length === 1 ? `The first one is ${spoken}` : `The first ${items.length} are ${spoken}`;
    return `You have ${total} things on your list. ${head}. The rest are in the app.`;
  }

  return `You have ${spoken} on your list.`;
}

/**
 * An Alexa response envelope.
 *
 * `endSession` false keeps the microphone open for the next thing — which is
 * what somebody adding to a list wants, because it is never just the one item.
 */
function say(speech, { endSession = true, reprompt = null, card = null } = {}) {
  const response = {
    outputSpeech: { type: 'PlainText', text: speech },
    shouldEndSession: endSession,
  };

  if (reprompt) {
    response.reprompt = { outputSpeech: { type: 'PlainText', text: reprompt } };
  }
  if (card) response.card = card;

  return { version: '1.0', response };
}

/**
 * The response for a cook whose Alexa account is not linked to a kitchen.
 *
 * The LinkAccount card is the only way to start linking from inside a skill —
 * it puts a "Link Account" button in the Alexa app's activity feed.
 */
function linkAccount() {
  return say(
    'To use your kitchen shopping list, link your MyKitchenHub account. I have put a link in the Alexa app.',
    { card: { type: 'LinkAccount' } }
  );
}

module.exports = {
  SPOKEN_LIMIT,
  spokenItem,
  joinSpoken,
  describeList,
  say,
  linkAccount,
};
