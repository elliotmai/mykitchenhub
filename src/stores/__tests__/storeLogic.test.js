import {
  NO_STORE,
  groupByStore,
  itemStoreKey,
  newStoreId,
  sortStores,
  storeFor,
  storeIdFor,
} from '../storeLogic';

const STORES = [
  { id: 'costco', name: 'Costco', order: 1 },
  { id: 'trader-joes', name: "Trader Joe's", order: 0 },
];

describe('remembering where an item is bought', () => {
  it('keys an item the same however it is written', () => {
    expect(itemStoreKey('Eggs')).toBe(itemStoreKey('egg'));
    expect(itemStoreKey('  Burger buns ')).toBe(itemStoreKey('burger bun'));
    expect(itemStoreKey('')).toBe('item');
  });

  it('a line’s own store wins, then the item’s usual store, then none', () => {
    const memory = { [itemStoreKey('milk')]: { store: 'costco' } };
    expect(storeFor({ name: 'Milk', store: 'trader-joes' }, memory, STORES)).toBe('trader-joes');
    expect(storeFor({ name: 'Milk' }, memory, STORES)).toBe('costco');
    expect(storeFor({ name: 'Bread' }, memory, STORES)).toBe(NO_STORE);
  });

  it('forgets a store that no longer exists', () => {
    const memory = { [itemStoreKey('milk')]: { store: 'gone' } };
    expect(storeFor({ name: 'Milk', store: 'gone' }, memory, STORES)).toBe(NO_STORE);
  });
});

describe('the list store by store', () => {
  const rows = [
    { name: 'Vodka', store: 'costco' },
    { name: 'Celery' },
    { name: 'Crackers', store: 'trader-joes' },
    { name: 'Butter', store: 'costco' },
  ];
  const storeOf = (row) => storeFor(row, {}, STORES);

  it('groups in the stores’ order, with No store yet last, and sorts within', () => {
    expect(
      groupByStore(rows, STORES, storeOf).map((g) => [g.label, g.items.map((i) => i.name)])
    ).toEqual([
      ["Trader Joe's", ['Crackers']],
      ['Costco', ['Butter', 'Vodka']],
      ['No store yet', ['Celery']],
    ]);
  });

  it('shows one store when filtered', () => {
    expect(groupByStore(rows, STORES, storeOf, 'costco').map((g) => g.key)).toEqual(['costco']);
    expect(groupByStore(rows, STORES, storeOf, NO_STORE).map((g) => g.key)).toEqual([NO_STORE]);
    expect(groupByStore([], STORES, storeOf)).toEqual([]);
  });

  it('names and orders stores', () => {
    expect(storeIdFor("Trader Joe's")).toBe('trader-joe-s');
    expect(storeIdFor('')).toBe('store');
    expect(newStoreId('Costco', STORES)).toBe('costco-2');
    expect(newStoreId('Winco', STORES)).toBe('winco');
    expect(sortStores(STORES).map((s) => s.id)).toEqual(['trader-joes', 'costco']);
  });
});
