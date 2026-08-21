/**
 * What the skill can do to a shopping list.
 *
 * Two sources feed one list — the rows somebody stored and the rows this week's
 * meals imply — and only the first is writable. Most of what is worth testing
 * here is that boundary: adding twice does not make two rows, and asking to
 * remove something the meal plan put there says so rather than lying about it.
 */

jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }));

const { readList, addItem, removeItem, shoppingKey, normalize } = require('../shoppingList');
const { createFirestore } = require('../__fixtures__/fakeFirestore');

const UID = 'user-123';
// A Wednesday, so the week it belongs to starts on the Monday before it.
const NOW = new Date('2026-08-19T18:00:00Z');
const WEEK_START = '2026-08-17';

const itemsPath = (id) => `users/${UID}/shoppingListItems/${id}`;
const planPath = `users/${UID}/mealPlans/${WEEK_START}`;

const stored = (overrides = {}) => ({
  name: 'Milk',
  normalized: 'milk',
  quantity: 1,
  unit: '',
  status: 'pending',
  source: 'manual',
  addedAt: NOW,
  boughtAt: null,
  ...overrides,
});

describe('addItem', () => {
  it('writes a row the security rules would have accepted', async () => {
    const db = createFirestore();

    const result = await addItem({ uid: UID, name: '  Milk  ', db, now: NOW });

    expect(result.added).toBe(true);
    const written = [...db.__store.values()][0];
    expect(written).toEqual({
      name: 'Milk',
      normalized: 'milk',
      quantity: 1,
      unit: '',
      status: 'pending',
      source: 'alexa',
      addedAt: NOW,
      boughtAt: null,
    });
  });

  it('keeps the quantity and unit when the cook says them', async () => {
    const db = createFirestore();

    await addItem({ uid: UID, name: 'potatoes', quantity: 2, unit: 'kg', db, now: NOW });

    expect([...db.__store.values()][0]).toMatchObject({ quantity: 2, unit: 'kg' });
  });

  it('falls back to one of a thing, because the rules reject a quantity of zero', async () => {
    const db = createFirestore();

    await addItem({ uid: UID, name: 'milk', quantity: 0, db, now: NOW });
    await addItem({ uid: UID, name: 'bread', quantity: 'lots', db, now: NOW });

    [...db.__store.values()].forEach((item) => expect(item.quantity).toBe(1));
  });

  it('does not add a second row for something already on the list', async () => {
    const db = createFirestore({ [itemsPath('existing')]: stored() });

    const result = await addItem({ uid: UID, name: 'MILK', db, now: NOW });

    expect(result).toMatchObject({ added: false, duplicate: true });
    expect(db.__store.size).toBe(1);
  });

  it('does add one when the only match was already bought', async () => {
    const db = createFirestore({ [itemsPath('old')]: stored({ status: 'bought' }) });

    const result = await addItem({ uid: UID, name: 'milk', db, now: NOW });

    expect(result.added).toBe(true);
    expect(db.__store.size).toBe(2);
  });

  it('refuses to add nothing', async () => {
    await expect(addItem({ uid: UID, name: '   ', db: createFirestore() })).rejects.toThrow(
      'Nothing to add'
    );
  });
});

describe('readList', () => {
  it('reads back what was stored', async () => {
    const db = createFirestore({
      [itemsPath('a')]: stored({ name: 'Milk', normalized: 'milk' }),
      [itemsPath('b')]: stored({ name: 'Bread', normalized: 'bread', source: 'alexa' }),
    });

    const { items, total } = await readList({ uid: UID, db, now: NOW });

    expect(total).toBe(2);
    expect(items.map((item) => item.name).sort()).toEqual(['Bread', 'Milk']);
  });

  it('leaves out what has already been bought', async () => {
    const db = createFirestore({
      [itemsPath('a')]: stored({ status: 'bought' }),
      [itemsPath('b')]: stored({ name: 'Bread', normalized: 'bread' }),
    });

    const { items } = await readList({ uid: UID, db, now: NOW });

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Bread');
  });

  it('adds what this week meals still need', async () => {
    const db = createFirestore({
      [itemsPath('a')]: stored(),
      [planPath]: {
        weekStart: WEEK_START,
        shoppingList: [
          { name: 'salmon', normalized: 'salmon', quantity: 2, unit: 'fillet', haveInInventory: false },
          { name: 'rice', normalized: 'rice', quantity: 1, unit: 'bag', haveInInventory: true },
        ],
      },
    });

    const { items, total } = await readList({ uid: UID, db, now: NOW });

    expect(total).toBe(2);
    // Rice is already in the kitchen, so it is not something to buy.
    expect(items.map((item) => item.name)).toEqual(['Milk', 'salmon']);
    expect(items[1]).toMatchObject({ fromPlan: true, source: 'meal-plan' });
  });

  it('does not say the same thing twice when both sources have it', async () => {
    const db = createFirestore({
      [itemsPath('a')]: stored({ name: 'Salmon', normalized: 'salmon', unit: 'fillet', quantity: 2 }),
      [planPath]: {
        shoppingList: [
          { name: 'salmon', normalized: 'salmon', quantity: 2, unit: 'fillet', haveInInventory: false },
        ],
      },
    });

    const { items, total } = await readList({ uid: UID, db, now: NOW });

    expect(total).toBe(1);
    expect(items[0].fromPlan).toBe(false);
  });

  it('is empty, not broken, for a kitchen with no plan and nothing on the list', async () => {
    await expect(readList({ uid: UID, db: createFirestore(), now: NOW })).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it('caps what it hands back, but still counts the rest', async () => {
    const seed = {};
    for (let i = 0; i < 15; i += 1) {
      seed[itemsPath(`item-${i}`)] = stored({ name: `Thing ${i}`, normalized: `thing ${i}` });
    }

    const { items, total } = await readList({ uid: UID, db: createFirestore(seed), now: NOW });

    expect(items).toHaveLength(10);
    expect(total).toBe(15);
  });
});

describe('removeItem', () => {
  it('takes a stored row off the list', async () => {
    const db = createFirestore({ [itemsPath('a')]: stored() });

    const result = await removeItem({ uid: UID, name: 'milk', db, now: NOW });

    expect(result).toMatchObject({ removed: true, name: 'Milk' });
    expect(db.__store.size).toBe(0);
  });

  it('clears every pending copy of it', async () => {
    const db = createFirestore({
      [itemsPath('a')]: stored(),
      [itemsPath('b')]: stored({ unit: 'litres', quantity: 2 }),
      [itemsPath('c')]: stored({ status: 'bought' }),
    });

    const result = await removeItem({ uid: UID, name: 'Milk', db, now: NOW });

    expect(result.count).toBe(2);
    // The bought one is history, not a list item — it stays.
    expect(db.__store.size).toBe(1);
  });

  it('explains that a meal-plan row cannot be removed by voice', async () => {
    const db = createFirestore({
      [planPath]: {
        shoppingList: [
          { name: 'salmon', normalized: 'salmon', quantity: 2, unit: 'fillet', haveInInventory: false },
        ],
      },
    });

    const result = await removeItem({ uid: UID, name: 'Salmon', db, now: NOW });

    expect(result).toMatchObject({ removed: false, fromPlan: true, name: 'salmon' });
  });

  it('says so when it is not on the list at all', async () => {
    const result = await removeItem({ uid: UID, name: 'caviar', db: createFirestore(), now: NOW });
    expect(result).toEqual({ removed: false, name: 'caviar' });
  });

  it('refuses to remove nothing', async () => {
    await expect(removeItem({ uid: UID, name: '', db: createFirestore() })).rejects.toThrow(
      'Nothing to remove'
    );
  });
});

describe('keys', () => {
  it('counts an ingredient and its unit together, as the app does', () => {
    expect(shoppingKey('Flour', 'Cup')).toBe('flour|cup');
    expect(shoppingKey(' Flour ', '')).toBe('flour|');
    expect(normalize('  MILK ')).toBe('milk');
  });
});
