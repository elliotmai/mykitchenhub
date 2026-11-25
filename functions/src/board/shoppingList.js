// functions/src/board/shoppingList.js
// The shopping list arithmetic — the Cloud Functions copy.
//
// PORTED FROM the React app, which is where the list is defined:
//
//   buildShoppingList, isUpcoming      src/hooks/useMealPlan.js
//   ingredientMeasure.js               src/utils/ingredientMeasure.js
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

const {
  canonicalUnit,
  cleanIngredientName,
  convertQuantity,
  formatAmount,
  ingredientAlternatives,
  ingredientKey,
  largerUnit,
  measureKey,
} = require('./ingredientMeasure');

const { isFarmSupplied } = require('../farm/farmEggs');

const capitalizeFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

const indexStock = (inventoryItems) => {
  const byName = new Map();
  const staples = new Set();

  inventoryItems.forEach((item) => {
    const name = ingredientKey(item.normalized || item.name);
    if (!name) return;
    // Eggs the farm is laying count as always on hand (src/utils/farmEggs.js).
    if (item.alwaysHave === true || isFarmSupplied(item, new Date().toISOString().slice(0, 10))) {
      staples.add(name);
      (Array.isArray(item.alsoCovers) ? item.alsoCovers : []).forEach((alias) => {
        const key = ingredientKey(alias);
        if (key) staples.add(key);
      });
    }
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ quantity: Number(item.quantity || 0), unit: item.unit || '' });
  });

  return (name, unit) => {
    if (staples.has(name)) return { onHand: 0, otherUnits: [], alwaysHave: true };
    const held = byName.get(name) || [];
    const wanted = canonicalUnit(unit);

    if (!wanted) {
      return { onHand: held.reduce((sum, entry) => sum + entry.quantity, 0), otherUnits: [] };
    }

    let onHand = 0;
    const otherUnits = [];
    held.forEach((entry) => {
      if (!canonicalUnit(entry.unit)) {
        onHand += entry.quantity;
        return;
      }
      const converted = convertQuantity(entry.quantity, entry.unit, wanted);
      if (converted === null) otherUnits.push(entry);
      else onHand += converted;
    });

    return { onHand: Math.round(onHand * 100) / 100, otherUnits };
  };
};

const foldAlternatives = (needed) => {
  [...needed.values()].forEach((item) => {
    const target = ingredientAlternatives(item.normalized)
      .map((alternative) => needed.get(`${alternative}|${item.measure}`))
      .find((candidate) => candidate && candidate !== item);
    if (!target) return;
    const unit = largerUnit(target.unit, item.unit);
    target.quantity =
      convertQuantity(target.quantity, target.unit, unit) +
      convertQuantity(item.quantity, item.unit, unit);
    target.unit = unit;
    needed.delete(item.key);
  });
};

/** See `buildShoppingList` in src/hooks/useMealPlan.js. */
const buildShoppingList = (entries = [], inventoryItems = [], boughtKeys = []) => {
  const onHandFor = indexStock(inventoryItems);
  const bought = new Set(boughtKeys);

  const needed = new Map();
  entries.filter(isUpcoming).forEach((entry) => {
    (entry.usesIngredients || []).forEach((ingredient) => {
      const normalized = ingredientKey(ingredient.normalized || ingredient.name);
      if (!normalized) return;
      const unit = canonicalUnit(ingredient.unit);
      const measure = measureKey(unit);
      const key = `${normalized}|${measure}`;
      const quantity = Number(ingredient.quantity || 0);
      const existing = needed.get(key);
      if (existing) {
        const shownIn = largerUnit(existing.unit, unit);
        existing.quantity =
          convertQuantity(existing.quantity, existing.unit, shownIn) +
          convertQuantity(quantity, unit, shownIn);
        existing.unit = shownIn;
      } else {
        needed.set(key, {
          key,
          // Cleaned of prep notes, first letter up: "Chicken breast", not
          // "Boneless Skinless Chicken Breast, Cut Into Bite-Sized Pieces".
          name: capitalizeFirst(cleanIngredientName(ingredient.name || normalized) || normalized),
          normalized,
          measure,
          quantity,
          unit,
        });
      }
    });
  });

  foldAlternatives(needed);

  return [...needed.values()]
    .map((item) => {
      const quantity = Math.round(item.quantity * 100) / 100;
      const { onHand, otherUnits, alwaysHave = false } = onHandFor(item.normalized, item.unit);
      return {
        ...item,
        quantity,
        onHand: alwaysHave ? quantity : onHand,
        otherUnits,
        alwaysHave,
        haveInInventory: alwaysHave || (onHand >= quantity && quantity > 0),
        bought: bought.has(item.key),
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
const buildShoppingItem = ({ name, quantity = null, unit = '', notes = '' } = {}) => {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return null;

  const parsed = quantity === '' || quantity === null ? NaN : Number(quantity);
  const cleanQuantity =
    Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;

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
  return formatAmount(quantity, unit) || null;
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
    outstandingManual.map((item) => ingredientKey(item.normalized || item.name)).filter(Boolean)
  );

  const rows = outstandingManual.map((item) => ({
    key: `manual-${item.id}`,
    name: item.name,
    amount: amountLabel(item),
    kind: 'manual',
    item,
  }));

  derivedItems
    .filter((item) => item.haveInInventory !== true && item.bought !== true)
    .filter((item) => !claimed.has(ingredientKey(item.normalized || item.name)))
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
