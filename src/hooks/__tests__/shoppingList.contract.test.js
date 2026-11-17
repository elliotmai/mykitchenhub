// The shopping list is computed in two places: in the app (ESM, React hooks)
// and in the `board` Cloud Function that serves it to Fridge Board (CJS, a
// separately deployed package — neither can import the other). The board API
// promises the list *exactly* as KitchenHub shows it, so the function carries a
// faithful copy rather than a re-implementation.
//
// This test runs one corpus through both copies and fails on any
// disagreement: about what a week needs, what the kitchen covers, how a typed
// item is normalised, which line a duplicate keeps, how an amount reads, or
// which aisle anything is filed in. It lives in the frontend suite because
// only this runner transpiles ESM, so the `unit` CI job guards a
// functions-only change too — as csvValidation.contract.test.js does.

import { buildShoppingList } from '../useMealPlan';
import { amountLabel, buildShoppingItem, combineShoppingList } from '../useShoppingList';
import {
  FALLBACK_SECTION,
  INGREDIENT_SECTIONS,
  STORE_SECTIONS,
  groupByStoreSection,
  sectionFor,
} from '../../config/storeSections';
import {
  ADD_INPUTS,
  CASES,
  MEASURE_NAMES,
  MEASURE_QUANTITIES,
  MEASURE_UNITS,
  SECTION_NAMES,
} from '../../test-utils/shoppingContractCorpus';
import * as measure from '../../utils/ingredientMeasure';

const server = require('../../../functions/src/board/shoppingList');
const serverSections = require('../../../functions/src/board/storeSections');
const serverMeasure = require('../../../functions/src/board/ingredientMeasure');

/** The server's derived row also carries its source line; everything else must match. */
const withoutSource = (rows) => rows.map(({ source, ...row }) => row);

describe('shopping list contract: the app and the board API agree', () => {
  describe.each(CASES.map((testCase) => [testCase.name, testCase]))('%s', (_name, testCase) => {
    const { entries, inventory, manualItems, boughtKeys = [] } = testCase;

    it('derives the same week', () => {
      expect(server.buildShoppingList(entries, inventory, boughtKeys)).toEqual(
        buildShoppingList(entries, inventory, boughtKeys)
      );
    });

    it('combines it with the typed list the same way', () => {
      const derived = buildShoppingList(entries, inventory, boughtKeys);
      expect(withoutSource(server.combineShoppingList(manualItems, derived))).toEqual(
        combineShoppingList(manualItems, derived)
      );
    });

    it('files every line in the same aisle, in the same order', () => {
      const rows = [...manualItems, ...buildShoppingList(entries, inventory, boughtKeys)];
      expect(serverSections.groupByStoreSection(rows)).toEqual(groupByStoreSection(rows));
    });

    it('labels every amount the same way', () => {
      [...manualItems, ...buildShoppingList(entries, inventory, boughtKeys)].forEach((item) => {
        expect(server.amountLabel(item)).toEqual(amountLabel(item));
      });
    });
  });

  it.each(ADD_INPUTS.map((input) => [JSON.stringify(input), input]))(
    'builds the same document for an added %s',
    (_label, input) => {
      expect(server.buildShoppingItem(input)).toEqual(buildShoppingItem(input));
    }
  );

  it.each(SECTION_NAMES.map((name) => [JSON.stringify(name), name]))(
    'files %s in the same aisle',
    (_label, name) => {
      expect(serverSections.sectionFor(name)).toBe(sectionFor(name));
    }
  );

  it('exports the same measure helpers', () => {
    expect(Object.keys(serverMeasure).sort()).toEqual(Object.keys(measure).sort());
  });

  it.each(MEASURE_NAMES.map((name) => [JSON.stringify(name), name]))(
    'cleans and keys %s the same way',
    (_label, name) => {
      expect(serverMeasure.cleanIngredientName(name)).toBe(measure.cleanIngredientName(name));
      expect(serverMeasure.ingredientKey(name)).toBe(measure.ingredientKey(name));
      const key = measure.ingredientKey(name);
      expect(serverMeasure.ingredientAlternatives(key)).toEqual(
        measure.ingredientAlternatives(key)
      );
    }
  );

  it.each(MEASURE_UNITS.map((unit) => [JSON.stringify(unit), unit]))(
    'reads and formats the unit %s the same way',
    (_label, unit) => {
      expect(serverMeasure.canonicalUnit(unit)).toBe(measure.canonicalUnit(unit));
      expect(serverMeasure.measureKey(unit)).toBe(measure.measureKey(unit));
      MEASURE_QUANTITIES.forEach((quantity) => {
        expect(serverMeasure.formatAmount(quantity, unit)).toBe(
          measure.formatAmount(quantity, unit)
        );
        expect(serverMeasure.convertQuantity(quantity, unit, 'tsp')).toBe(
          measure.convertQuantity(quantity, unit, 'tsp')
        );
      });
    }
  );

  it('carries the same aisle table, ingredient for ingredient', () => {
    expect(serverSections.STORE_SECTIONS).toEqual(STORE_SECTIONS);
    expect(serverSections.FALLBACK_SECTION).toBe(FALLBACK_SECTION);
    expect(serverSections.INGREDIENT_SECTIONS).toEqual(INGREDIENT_SECTIONS);
  });
});
