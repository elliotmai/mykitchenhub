// functions/src/board/shoppingList.js
// The shopping list arithmetic — the Cloud Functions copy.
//
// PORTED FROM the React app, which is where the list is defined:
//
//   buildShoppingList, isUpcoming      src/hooks/useMealPlan.js
//   normalizeName, buildShoppingItem,
//   amountLabel, combineShoppingList   src/hooks/useShoppingList.js
//
// The app is ESM bundled by CRA and this package is CommonJS deployed on its
// own, so neither can import the other. The functions are copied as they are,
// down to the rounding — the `board` API promises Fridge Board the list
// "exactly as KitchenHub shows it", and a second implementation that differs
// in one corner is a list that is true in two different ways.
//
// A change to either side belongs in both, in the same commit.
// src/hooks/__tests__/shoppingList.contract.test.js runs both over one corpus
// (src/test-utils/shoppingContractCorpus.js) and fails on any disagreement.
//
// Comments explaining *why* each rule exists live with the originals and are
// not repeated here.

/** See `isUpcoming` in src/hooks/useMealPlan.js. */
const isUpcoming = (entry) => entry?.status !== 'cooked' && entry?.status !== 'skipped';

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const shoppingKey = (name, unit) => `${normalize(name)}|${normalize(unit)}`;

const indexStock = (inventoryItems) => {
  const byNameAndUnit = new Map();
  const unitlessByName = new Map();
  const byName = new Map();

  inventoryItems.forEach((item) => {
    const name = normalize(item.normalized || item.name);
    const unit = normalize(item.unit);
    const quantity = Number(item.quantity || 0);
    const add = (map, key) => map.set(key, (map.get(key) ?? 0) + quantity);

    add(byNameAndUnit, shoppingKey(name, unit));
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ quantity, unit: item.unit || '' });
    if (!unit) add(unitlessByName, name);
  });

  return (name, unit) => {
    const key = normalize(name);
    const held = byName.get(key) || [];
    const wanted = normalize(unit);

    if (!wanted) {
      return { onHand: held.reduce((sum, entry) => sum + entry.quantity, 0), otherUnits: [] };
    }

    const onHand =
      (byNameAndUnit.get(shoppingKey(key, wanted)) ?? 0) + (unitlessByName.get(key) ?? 0);
    const otherUnits = held.filter(
      (entry) => normalize(entry.unit) && normalize(entry.unit) !== wanted
    );

    return { onHand, otherUnits };
  };
};

/** See `buildShoppingList` in src/hooks/useMealPlan.js. */
const buildShoppingList = (entries = [], inventoryItems = []) => {
  const onHandFor = indexStock(inventoryItems);

  const needed = new Map();
  entries.filter(isUpcoming).forEach((entry) => {
    (entry.usesIngredients || []).forEach((ingredient) => {
      const normalized = normalize(ingredient.normalized || ingredient.name);
      if (!normalized) return;
      const unit = ingredient.unit || '';
      const key = shoppingKey(normalized, unit);
      const existing = needed.get(key);
      const quantity = Number(ingredient.quantity || 0);
      if (existing) {
        existing.quantity += quantity;
      } else {
        needed.set(key, {
          key,
          name: ingredient.name || normalized,
          normalized,
          quantity,
          unit,
        });
      }
    });
  });

  return [...needed.values()]
    .map((item) => {
      const { onHand, otherUnits } = onHandFor(item.normalized, item.unit);
      return {
        ...item,
        quantity: Math.round(item.quantity * 100) / 100,
        onHand,
        otherUnits,
        haveInInventory: onHand >= item.quantity && item.quantity > 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
};

/** See `normalizeName` in src/hooks/useShoppingList.js. */
const normalizeName = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/** See `buildShoppingItem` in src/hooks/useShoppingList.js. */
const buildShoppingItem = ({ name, quantity = 1, unit = '', notes = '' } = {}) => {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return null;

  const parsed = Number(quantity);
  const cleanQuantity = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 1;

  return {
    name: cleanName,
    normalized: normalizeName(cleanName),
    quantity: cleanQuantity,
    unit: String(unit ?? '').trim(),
    notes: String(notes ?? '').trim(),
    status: 'pending',
    source: 'manual',
    boughtAt: null,
  };
};

/** See `amountLabel` in src/hooks/useShoppingList.js. */
const amountLabel = (item) => {
  const quantity = Number(item?.quantity ?? 0);
  const unit = String(item?.unit ?? '').trim();
  if (!quantity) return unit || null;
  if (quantity === 1 && !unit) return null;
  return unit ? `${quantity} ${unit}` : String(quantity);
};

/**
 * See `combineShoppingList` in src/hooks/useShoppingList.js.
 *
 * One addition, which the original does not need: a derived row also carries
 * the `source` row it came from, because the board API has to say which meals
 * a line is for and how to address it. Every field the original returns is
 * returned unchanged, and the contract test compares those.
 */
const combineShoppingList = (manualItems = [], derivedItems = []) => {
  const outstandingManual = manualItems.filter((item) => item.status !== 'bought');
  const claimed = new Set(
    outstandingManual.map((item) => normalizeName(item.normalized || item.name)).filter(Boolean)
  );

  const rows = outstandingManual.map((item) => ({
    key: `manual-${item.id}`,
    name: item.name,
    amount: amountLabel(item),
    kind: 'manual',
    item,
  }));

  derivedItems
    .filter((item) => item.haveInInventory !== true)
    .filter((item) => !claimed.has(normalizeName(item.normalized || item.name)))
    .forEach((item) => {
      rows.push({
        key: `derived-${item.key ?? `${item.normalized} ${item.unit}`}`,
        name: item.name,
        amount: amountLabel(item),
        kind: 'derived',
        source: item,
      });
    });

  return rows;
};

module.exports = {
  isUpcoming,
  buildShoppingList,
  normalizeName,
  buildShoppingItem,
  amountLabel,
  combineShoppingList,
};
