import { makeFakeSupabase } from '../../test-utils/fakeSupabase';

const mockFake = makeFakeSupabase();

jest.mock('../supabase', () => ({
  get supabase() {
    return mockFake.supabase;
  },
  get kitchen() {
    return mockFake.kitchen;
  },
  myHousehold: async () => 'hh-1',
}));
jest.unmock('../firestore');

const fs = jest.requireActual('../firestore');

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockFake.rows.splice(0);
});

describe('paths', () => {
  it("stores a cook's kitchen collections as the household's", () => {
    expect(fs.collection(fs.getFirestore(), 'users', 'u1', 'inventory').path).toBe('inventory');
    expect(fs.doc(fs.getFirestore(), 'users', 'u1', 'mealPlans', '2026-11-23').path).toBe(
      'mealPlans/2026-11-23'
    );
  });

  it("keeps a cook's profile and notifications as their own", () => {
    expect(fs.doc(fs.getFirestore(), 'users', 'u1').path).toBe('users/u1');
    expect(fs.collection(fs.doc(fs.getFirestore(), 'users', 'u1'), 'notifications').path).toBe(
      'users/u1/notifications'
    );
  });

  it('gives a new document a 20-character id', () => {
    const ref = fs.doc(fs.collection(fs.getFirestore(), 'recipes'));
    expect(ref.id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(ref.parent.path).toBe('recipes');
  });
});

describe('writes and reads', () => {
  const db = fs.getFirestore();

  it('adds, reads back with Timestamps, and deletes', async () => {
    const ref = await fs.addDoc(fs.collection(db, 'users', 'u1', 'inventory'), {
      name: 'Milk',
      addedAt: fs.serverTimestamp(),
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      note: undefined,
    });
    expect(mockFake.rows[0]).toMatchObject({ household_id: 'hh-1', path: `inventory/${ref.id}` });
    expect(mockFake.rows[0].data).not.toHaveProperty('note');

    const snap = await fs.getDoc(ref);
    expect(snap.exists()).toBe(true);
    expect(snap.data().expiresAt.toDate().toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(typeof snap.data().addedAt.toMillis()).toBe('number');
    expect(snap.get('name')).toBe('Milk');

    await fs.deleteDoc(ref);
    expect((await fs.getDoc(ref)).exists()).toBe(false);
  });

  it('updates with dotted fields, increment and array operations', async () => {
    const ref = fs.doc(db, 'recipes', 'r1');
    await fs.setDoc(ref, { timesCooked: 1, tags: ['a'], prefs: { x: 1, y: 2 } });
    await fs.updateDoc(ref, {
      timesCooked: fs.increment(2),
      tags: fs.arrayUnion('b', 'a'),
      'prefs.y': 3,
    });
    await fs.updateDoc(ref, { tags: fs.arrayRemove('a') });
    expect((await fs.getDoc(ref)).data()).toEqual({
      timesCooked: 3,
      tags: ['b'],
      prefs: { x: 1, y: 3 },
    });
  });

  it('refuses to update a document that is not there', async () => {
    await expect(fs.updateDoc(fs.doc(db, 'recipes', 'nope'), { a: 1 })).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('merges a set into what is there', async () => {
    const ref = fs.doc(db, 'users', 'u1');
    await fs.setDoc(ref, {
      email: 'a@b.c',
      preferences: { smsAlerts: { enabled: false }, other: 1 },
    });
    await fs.setDoc(ref, { preferences: { smsAlerts: { enabled: true } } }, { merge: true });
    expect((await fs.getDoc(ref)).data()).toEqual({
      email: 'a@b.c',
      preferences: { smsAlerts: { enabled: true }, other: 1 },
    });
  });

  it('commits a batch in order', async () => {
    const col = fs.collection(db, 'recipes');
    const batch = fs.writeBatch(db);
    batch.set(fs.doc(col, 'a'), { n: 1 });
    batch.set(fs.doc(col, 'b'), { n: 2 });
    batch.delete(fs.doc(col, 'a'));
    await batch.commit();
    expect(mockFake.rows.map((r) => r.path)).toEqual(['recipes/b']);
  });

  it('turns a database refusal into a Firestore-style code', async () => {
    mockFake.failNextWith({ code: '42501', message: 'new row violates row-level security policy' });
    await expect(fs.getDoc(fs.doc(db, 'recipes', 'x'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});

describe('queries', () => {
  const db = fs.getFirestore();
  const entries = fs.collection(db, 'users', 'u1', 'mealPlanEntries');

  beforeEach(async () => {
    await fs.setDoc(fs.doc(entries, 'e1'), { date: '2026-11-24', mealType: 'dinner' });
    await fs.setDoc(fs.doc(entries, 'e2'), { date: '2026-11-22', mealType: 'lunch' });
    await fs.setDoc(fs.doc(entries, 'e3'), { date: '2026-12-09', mealType: 'dinner' });
    await fs.setDoc(fs.doc(entries, 'e4'), { mealType: 'dinner' });
  });

  it('filters, sorts and limits like Firestore', async () => {
    const snap = await fs.getDocs(
      fs.query(
        entries,
        fs.where('date', '>=', '2026-11-20'),
        fs.where('date', '<=', '2026-11-30'),
        fs.orderBy('date', 'asc')
      )
    );
    expect(snap.docs.map((d) => d.id)).toEqual(['e2', 'e1']);

    const last = await fs.getDocs(fs.query(entries, fs.orderBy('date', 'desc'), fs.limit(1)));
    expect(last.docs.map((d) => d.id)).toEqual(['e3']);

    const dinners = await fs.getDocs(fs.query(entries, fs.where('mealType', '==', 'dinner')));
    expect(dinners.size).toBe(3);
    expect((await fs.getCountFromServer(entries)).data().count).toBe(4);
  });

  it('feeds a listener now, after its own writes, and after changes from elsewhere', async () => {
    const seen = [];
    const stop = fs.onSnapshot(fs.query(entries, fs.orderBy('date')), (snap) =>
      seen.push(snap.docs.map((d) => d.id))
    );
    await flush();
    await flush();
    expect(seen.at(-1)).toEqual(['e2', 'e1', 'e3']);

    await fs.deleteDoc(fs.doc(entries, 'e1'));
    await flush();
    await flush();
    expect(seen.at(-1)).toEqual(['e2', 'e3']);

    // Someone else in the household writes: Realtime tells us.
    mockFake.rows.push({
      household_id: 'hh-1',
      path: 'mealPlanEntries/e5',
      data: { date: '2026-11-01' },
    });
    mockFake.channels.at(-1).handlers.forEach((h) => h({ new: { path: 'mealPlanEntries/e5' } }));
    await flush();
    await flush();
    expect(seen.at(-1)).toEqual(['e5', 'e2', 'e3']);

    stop();
    expect(mockFake.supabase.removeChannel).toHaveBeenCalled();
  });

  it('watches a single document', async () => {
    const seen = [];
    const stop = fs.onSnapshot(fs.doc(db, 'syncMetadata', 'legacy'), {
      next: (snap) => seen.push(snap.exists()),
    });
    await flush();
    await fs.setDoc(fs.doc(db, 'syncMetadata', 'legacy'), { enabled: true });
    await flush();
    await flush();
    expect(seen).toEqual([false, true]);
    stop();
  });
});
