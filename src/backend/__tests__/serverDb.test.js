import { makeFakeSupabase } from '../../test-utils/fakeSupabase';
import { makeServerDb } from '../serverDb';
import { OP, sentinel } from '../docModel';

// The same markers functions/src/utils/fieldValue.js makes.
const FieldValue = {
  serverTimestamp: () => sentinel('serverTimestamp'),
  increment: (n) => sentinel('increment', n),
  arrayUnion: (...v) => sentinel('arrayUnion', v),
};

it('speaks the marker the server code uses', () => {
  expect(OP).toBe('__kitchenOp');
});

const setup = (opts = {}) => {
  const fake = makeFakeSupabase();
  const client = { schema: () => fake.kitchen };
  return { fake, db: makeServerDb({ client, householdId: 'hh-1', ...opts }) };
};

it('needs a household', () => {
  expect(() => makeServerDb({ client: {} })).toThrow('household');
});

it("reads and writes the household's kitchen the way firebase-admin did", async () => {
  const { fake, db } = setup();
  const user = db.collection('users').doc('u1');
  await user.set({ email: 'a@b.c', preferences: { smsAlerts: { enabled: true } } });
  const ref = await user
    .collection('inventory')
    .add({ name: 'Milk', addedAt: FieldValue.serverTimestamp() });

  expect(fake.rows.map((r) => r.path).sort()).toEqual([`inventory/${ref.id}`, 'users/u1']);
  expect(fake.rows.every((r) => r.household_id === 'hh-1')).toBe(true);

  const snap = await ref.get();
  expect(snap.exists).toBe(true);
  expect(snap.data().addedAt.toDate()).toBeInstanceOf(Date);
  expect(snap.get('name')).toBe('Milk');
  expect(ref.parent.path).toBe('inventory');

  await ref.update({ quantity: FieldValue.increment(2), tags: FieldValue.arrayUnion('x') });
  expect((await ref.get()).data()).toMatchObject({ quantity: 2, tags: ['x'] });
  await expect(db.doc('inventory/none').update({ a: 1 })).rejects.toThrow('No document');

  await user.set({ phone: '1' }, { merge: true });
  expect((await user.get()).data()).toMatchObject({ email: 'a@b.c', phone: '1' });

  const [a, b] = await db.getAll(user, db.doc('users', 'nobody'));
  expect([a.exists, b.exists]).toEqual([true, false]);

  await ref.delete();
  expect((await ref.get()).exists).toBe(false);
});

it('queries, counts, pages by name and batches', async () => {
  const { db } = setup();
  const entries = db.collection('users').doc('u1').collection('mealPlanEntries');
  const batch = db.batch();
  batch.set(entries.doc('a'), { date: '2026-11-24' });
  batch.set(entries.doc('b'), { date: '2026-11-20' });
  batch.set(entries.doc('c'), { date: '2026-12-01' });
  batch.set(db.collection('recipes').doc('r1'), { name: 'Soup' });
  await batch.commit();

  const snap = await entries.where('date', '<=', '2026-11-30').orderBy('date').limit(5).get();
  expect(snap.docs.map((d) => d.id)).toEqual(['b', 'a']);
  expect((await entries.count().get()).data().count).toBe(3);

  const page = await db.collectionGroup('mealPlanEntries').orderBy('__name__').limit(2).get();
  expect(page.docs.map((d) => d.ref.path)).toEqual(['mealPlanEntries/a', 'mealPlanEntries/b']);
  const next = await db
    .collectionGroup('mealPlanEntries')
    .orderBy('__name__')
    .startAfter(db.doc('mealPlanEntries/b'))
    .get();
  expect(next.docs.map((d) => d.id)).toEqual(['c']);
  const last = await db
    .collectionGroup('mealPlanEntries')
    .orderBy('__name__', 'desc')
    .limit(1)
    .get();
  expect(last.docs[0].id).toBe('c');

  const b2 = db.batch();
  b2.update(entries.doc('a'), { date: '2026-11-25' }).delete(entries.doc('c'));
  await b2.commit();
  expect((await entries.get()).size).toBe(2);
});

it('refuses writes when read-only, and reports database errors', async () => {
  const { fake, db } = setup({ readOnly: true, schema: 'letseat' });
  await expect(db.doc('recipes/x').set({ a: 1 })).rejects.toThrow('read-only');
  await expect(db.doc('recipes/x').delete()).rejects.toThrow('read-only');
  fake.failNextWith({ code: 'XX', message: 'boom' });
  await expect(db.doc('recipes/x').get()).rejects.toThrow('boom');
});
