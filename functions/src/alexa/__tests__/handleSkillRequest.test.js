/**
 * The conversation itself.
 *
 * Everything the skill can be asked, and the two answers that are not about
 * shopping at all: an unlinked account gets a Link Account card rather than a
 * refusal, and a session that has ended gets nothing back.
 *
 * The list operations are injected, so these tests are about what is *said* —
 * shoppingList.test.js covers what is written.
 */

jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }));

const { handleSkillRequest, slotValue, numericSlot, HELP_TEXT } = require('../handleSkillRequest');
const { spokenItem, describeList, joinSpoken, say, linkAccount } = require('../speech');

const UID = 'user-123';
const NOW = new Date('2026-08-21T10:00:00Z');

const linked = { resolveAccessToken: jest.fn(async () => UID) };

const request = (type, overrides = {}) => ({
  version: '1.0',
  context: { System: { user: { accessToken: 'live-token' }, application: {} } },
  request: { type, timestamp: NOW.toISOString(), ...overrides },
});

const intent = (name, slots = {}) =>
  request('IntentRequest', {
    intent: {
      name,
      slots: Object.fromEntries(
        Object.entries(slots).map(([key, value]) => [key, { name: key, value }])
      ),
    },
  });

const speechOf = (response) => response.response.outputSpeech.text;

const run = (body, deps = {}) => handleSkillRequest(body, { now: NOW, deps: { ...linked, ...deps } });

afterEach(() => jest.clearAllMocks());

describe('account linking', () => {
  it('asks an unlinked cook to link, with the card that starts it', async () => {
    const response = await run(intent('ReadListIntent'), {
      resolveAccessToken: async () => null,
    });

    expect(response.response.card).toEqual({ type: 'LinkAccount' });
    expect(speechOf(response)).toMatch(/link your MyKitchenHub account/i);
  });

  it('reads the access token from either place Alexa puts it', async () => {
    const resolveAccessToken = jest.fn(async () => UID);
    const sessionOnly = {
      session: { user: { accessToken: 'session-token' } },
      request: { type: 'LaunchRequest' },
    };

    await handleSkillRequest(sessionOnly, { now: NOW, deps: { resolveAccessToken } });

    expect(resolveAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'session-token' })
    );
  });
});

describe('adding', () => {
  it('adds what it heard and keeps listening for the next thing', async () => {
    const addItem = jest.fn(async () => ({ added: true }));

    const response = await run(intent('AddItemIntent', { item: 'milk' }), { addItem });

    expect(addItem).toHaveBeenCalledWith(expect.objectContaining({ uid: UID, name: 'milk' }));
    expect(speechOf(response)).toBe('Added milk to your shopping list.');
    // Nobody adds one thing; the microphone stays open.
    expect(response.response.shouldEndSession).toBe(false);
  });

  it('passes a quantity and unit through when they were spoken', async () => {
    const addItem = jest.fn(async () => ({ added: true }));

    await run(intent('AddItemIntent', { item: 'potatoes', quantity: '2', unit: 'kilos' }), { addItem });

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'potatoes', quantity: 2, unit: 'kilos' })
    );
  });

  it('says when something is already on the list instead of adding it twice', async () => {
    const addItem = jest.fn(async () => ({ added: false, duplicate: true }));

    const response = await run(intent('AddItemIntent', { item: 'milk' }), { addItem });

    expect(speechOf(response)).toBe('milk is already on your list.');
  });

  it('asks what to add when it caught the intent but not the item', async () => {
    const addItem = jest.fn();

    const response = await run(intent('AddItemIntent'), { addItem });

    expect(addItem).not.toHaveBeenCalled();
    expect(speechOf(response)).toMatch(/What would you like me to add/);
    expect(response.response.shouldEndSession).toBe(false);
  });
});

describe('removing', () => {
  it('confirms with the name as it is stored, not as it was heard', async () => {
    const removeItem = jest.fn(async () => ({ removed: true, name: 'Milk' }));

    const response = await run(intent('RemoveItemIntent', { item: 'milk' }), { removeItem });

    expect(speechOf(response)).toBe('Removed Milk from your list.');
  });

  it('explains a row the meal plan owns rather than pretending to remove it', async () => {
    const removeItem = jest.fn(async () => ({ removed: false, fromPlan: true, name: 'salmon' }));

    const response = await run(intent('RemoveItemIntent', { item: 'salmon' }), { removeItem });

    expect(speechOf(response)).toMatch(/a meal this week needs it/);
  });

  it('says when it could not find it', async () => {
    const removeItem = jest.fn(async () => ({ removed: false, name: 'caviar' }));

    const response = await run(intent('RemoveItemIntent', { item: 'caviar' }), { removeItem });

    expect(speechOf(response)).toBe('I could not find caviar on your list.');
  });

  it('asks what to remove when no item was caught', async () => {
    const removeItem = jest.fn();

    await run(intent('RemoveItemIntent'), { removeItem });

    expect(removeItem).not.toHaveBeenCalled();
  });
});

describe('reading the list', () => {
  it('reads it out', async () => {
    const readList = jest.fn(async () => ({
      items: [
        { name: 'milk', quantity: 1, unit: '' },
        { name: 'potatoes', quantity: 2, unit: 'kg' },
      ],
      total: 2,
    }));

    const response = await run(intent('ReadListIntent'), { readList });

    expect(speechOf(response)).toBe('You have milk and 2 kg of potatoes on your list.');
    expect(response.response.shouldEndSession).toBe(true);
  });

  it('says so when there is nothing on it', async () => {
    const readList = jest.fn(async () => ({ items: [], total: 0 }));

    const response = await run(intent('ReadListIntent'), { readList });

    expect(speechOf(response)).toBe('Your shopping list is empty.');
  });
});

describe('the rest of the conversation', () => {
  it('opens with something to do', async () => {
    const response = await run(request('LaunchRequest'));

    expect(speechOf(response)).toMatch(/Your kitchen is listening/);
    expect(response.response.shouldEndSession).toBe(false);
  });

  it('answers for help, and for anything it did not catch', async () => {
    await expect(run(intent('AMAZON.HelpIntent')).then(speechOf)).resolves.toBe(HELP_TEXT);
    await expect(run(intent('AMAZON.FallbackIntent')).then(speechOf)).resolves.toMatch(
      /did not catch that/
    );
    await expect(run(intent('SomeIntentWeDoNotHave')).then(speechOf)).resolves.toMatch(
      /did not catch that/
    );
  });

  it('says goodbye and means it', async () => {
    const stop = await run(intent('AMAZON.StopIntent'));
    expect(speechOf(stop)).toBe('Goodbye.');
    expect(stop.response.shouldEndSession).toBe(true);

    await expect(run(intent('AMAZON.CancelIntent')).then(speechOf)).resolves.toBe('Goodbye.');
  });

  it('answers a session that has already ended with nothing at all', async () => {
    const resolveAccessToken = jest.fn();

    const response = await handleSkillRequest(request('SessionEndedRequest'), {
      now: NOW,
      deps: { resolveAccessToken },
    });

    expect(response).toEqual({ version: '1.0', response: {} });
    // There is nobody to answer, so there is no reason to look anybody up.
    expect(resolveAccessToken).not.toHaveBeenCalled();
  });
});

describe('slots', () => {
  it('prefers the value Alexa resolved to the one it heard', () => {
    const withResolution = {
      slots: {
        item: {
          name: 'item',
          value: 'tomatos',
          resolutions: {
            resolutionsPerAuthority: [
              { status: { code: 'ER_SUCCESS_MATCH' }, values: [{ value: { name: 'tomatoes' } }] },
            ],
          },
        },
      },
    };

    expect(slotValue(withResolution, 'item')).toBe('tomatoes');
  });

  it('falls back to what was heard when nothing matched the slot type', () => {
    const noMatch = {
      slots: {
        item: {
          name: 'item',
          value: 'quince paste',
          resolutions: {
            resolutionsPerAuthority: [{ status: { code: 'ER_SUCCESS_NO_MATCH' }, values: [] }],
          },
        },
      },
    };

    expect(slotValue(noMatch, 'item')).toBe('quince paste');
  });

  it('is null for a slot that was never filled', () => {
    expect(slotValue({ slots: {} }, 'item')).toBeNull();
    expect(slotValue({ slots: { item: { name: 'item' } } }, 'item')).toBeNull();
    expect(slotValue(undefined, 'item')).toBeNull();
  });

  it('only accepts a number that could be a quantity', () => {
    expect(numericSlot({ slots: { quantity: { value: '3' } } }, 'quantity')).toBe(3);
    expect(numericSlot({ slots: { quantity: { value: '0' } } }, 'quantity')).toBeNull();
    expect(numericSlot({ slots: { quantity: { value: '?' } } }, 'quantity')).toBeNull();
    expect(numericSlot({ slots: {} }, 'quantity')).toBeNull();
  });
});

describe('speech', () => {
  it('says quantities only when they say something', () => {
    expect(spokenItem({ name: 'milk', quantity: 1, unit: '' })).toBe('milk');
    expect(spokenItem({ name: 'milk', quantity: 1, unit: 'litre' })).toBe('1 litre of milk');
    expect(spokenItem({ name: 'onions', quantity: 3, unit: '' })).toBe('3 onions');
    expect(spokenItem({ name: 'flour', quantity: 500, unit: 'g' })).toBe('500 g of flour');
    expect(spokenItem({ name: 'bread' })).toBe('bread');
  });

  it('joins a list the way a person would read it', () => {
    expect(joinSpoken(['milk'])).toBe('milk');
    expect(joinSpoken(['milk', 'bread'])).toBe('milk and bread');
    expect(joinSpoken(['milk', 'bread', 'eggs'])).toBe('milk, bread and eggs');
    expect(joinSpoken([])).toBe('');
  });

  it('stops reading a long list out loud and says where the rest is', () => {
    const items = [{ name: 'milk', quantity: 1 }, { name: 'bread', quantity: 1 }];

    expect(describeList(items, 14)).toBe(
      'You have 14 things on your list. The first 2 are milk and bread. The rest are in the app.'
    );
    expect(describeList([items[0]], 3)).toMatch(/The first one is milk/);
  });

  it('keeps the microphone open only when it asked something', () => {
    expect(say('done').response.shouldEndSession).toBe(true);
    expect(say('what else?', { endSession: false, reprompt: 'well?' }).response).toMatchObject({
      shouldEndSession: false,
      reprompt: { outputSpeech: { type: 'PlainText', text: 'well?' } },
    });
    expect(linkAccount().response.card).toEqual({ type: 'LinkAccount' });
  });
});
