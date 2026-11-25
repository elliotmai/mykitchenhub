import { collectedOn, farmLine, isFarmSupplied, lastCollection } from '../farmEggs';
import { buildShoppingList } from '../../hooks/useMealPlan';

// The server copy of the same rules (see the header of ../farmEggs.js).
const server = require('../../../functions/src/farm/farmEggs');
const serverList = require('../../../functions/src/board/shoppingList');

const TODAY = '2026-11-25';
const farmItem = (entries) => ({
  id: 'galaxyfarm-eggs',
  name: 'Eggs',
  normalized: 'eggs',
  quantity: 2,
  unit: '',
  farm: { source: 'galaxyfarm', name: 'Galaxy Farm', horizon: '2026-08-01', entries },
});

describe('farmEggs (app side)', () => {
  const item = farmItem({
    'l:a': { v: 1, n: 4, d: TODAY },
    'l:b': { v: 1, n: 2, d: TODAY },
    'l:c': { v: 1, n: 7, d: '2026-11-24' },
    'd:x': { v: 1, n: -3, d: TODAY, k: 'given' },
  });

  it('says where the eggs come from and how many came in today', () => {
    expect(farmLine(item, TODAY)).toBe('From Galaxy Farm · 6 collected today');
    expect(farmLine(item, '2026-11-26')).toMatch(/^From Galaxy Farm · last collected /);
    expect(farmLine({ name: 'Milk' }, TODAY)).toBeNull();
  });

  it('agrees with the server copy', () => {
    ['2026-11-24', TODAY, '2026-11-26'].forEach((day) => {
      expect(collectedOn(item.farm, day)).toBe(server.collectedOn(item.farm, day));
    });
    expect(lastCollection(item.farm)).toBe(server.lastCollection(item.farm));
    ['2026-12-09', '2026-12-10'].forEach((day) => {
      expect(isFarmSupplied(item, day)).toBe(server.isFarmSupplied(item, day));
    });
  });

  it('keeps eggs off the shopping list while the farm supplies them, on both lists', () => {
    const recent = farmItem({ 'l:a': { v: 1, n: 6, d: new Date().toISOString().slice(0, 10) } });
    const entries = [
      {
        date: '2099-01-01',
        status: 'planned',
        usesIngredients: [{ name: 'eggs', quantity: 12 }],
      },
    ];
    const [app] = buildShoppingList(entries, [recent]);
    const [board] = serverList.buildShoppingList(entries, [recent]);
    expect(app.haveInInventory).toBe(true);
    expect(board.haveInInventory).toBe(true);

    // A farm that has stopped laying is not supplying: two eggs do not cover twelve.
    const stale = farmItem({ 'l:a': { v: 1, n: 6, d: '2020-01-01' } });
    expect(buildShoppingList(entries, [stale])[0].haveInInventory).toBe(false);
    expect(serverList.buildShoppingList(entries, [stale])[0].haveInInventory).toBe(false);
  });
});
