// The CSV rules are implemented twice: once in the browser (ESM, so the
// preview can be shown before anything is written) and once in the Cloud
// Function (CJS, because the server must never trust the client). Duplicating
// the *intent* is correct. Duplicating the *logic* is how you get a row the
// preview accepts and the server silently drops.
//
// This test runs one corpus of files through both and fails on any
// disagreement — about which rows are accepted, what they normalise to, what
// the errors say, or which line each row is reported as. This repo has been
// bitten twice by exactly this (a shelf-life table, and locations keyed `name`
// in one layer and `label` in another), so drift is a red build, not a
// surprise in production.
//
// It lives in the frontend suite because only that runner transpiles ESM; the
// `unit` CI job therefore guards a functions-only change too.

import * as browser from '../csvValidation';
import { CASES, LOCATIONS } from '../../../test-utils/csvContractCorpus';

const server = require('../../../../functions/src/csvImport/csvValidation');

/** Dates and undefined don't survive a plain equality check across modules. */
const serialise = (value) => JSON.parse(JSON.stringify(value ?? null));

const summarise = (result) => ({
  hasFileError: Boolean(result.fileError),
  headers: result.headers,
  totalRows: result.totalRows,
  validRows: result.validRows.map((row) => ({ row: row.row, data: serialise(row.data) })),
  errorRows: result.errorRows.map((row) => ({ row: row.row, errors: row.errors })),
});

/** The corpus, minus the one case whose wording is allowed to differ. */
const WORDING_CASES = CASES.filter((testCase) => (testCase.locations ?? LOCATIONS).length > 0);

describe('CSV validation contract: browser and Cloud Function agree', () => {
  it.each(CASES.map((testCase) => [testCase.name, testCase]))('%s', (_name, testCase) => {
    const locations = testCase.locations ?? LOCATIONS;

    const fromBrowser = browser.validateCSV(testCase.text, locations);
    const fromServer = server.validateCSV(testCase.text, locations);

    expect(summarise(fromServer)).toEqual(summarise(fromBrowser));
  });

  // The wording is part of the contract too — an error a person cannot act on
  // is barely better than none — with one deliberate exception below.
  it.each(WORDING_CASES.map((testCase) => [testCase.name, testCase]))(
    'explains %s in the same words',
    (_name, testCase) => {
      const locations = testCase.locations ?? LOCATIONS;

      expect(server.validateCSV(testCase.text, locations).fileError).toEqual(
        browser.validateCSV(testCase.text, locations).fileError
      );
    }
  );

  it('sends the browser to Settings for a missing location, and the API caller nowhere', () => {
    // The only wording allowed to differ: an HTTP caller has no Settings screen
    // to be pointed at.
    const text = 'name,quantity,location\nMilk,1,Pantry';

    expect(browser.validateCSV(text, []).fileError).toMatch(/Settings/);
    expect(server.validateCSV(text, []).fileError).toMatch(/no storage locations/);
  });

  it.each(CASES.map((testCase) => [testCase.name, testCase]))(
    'parses %s into the same rows and line numbers',
    (_name, testCase) => {
      const fromBrowser = browser.parseCSVText(testCase.text);
      const fromServer = server.parseCSVText(testCase.text);

      expect(fromServer.headers).toEqual(fromBrowser.headers);
      expect(fromServer.lines).toEqual(fromBrowser.lines);
      expect(serialise(fromServer.rows)).toEqual(serialise(fromBrowser.rows));
    }
  );

  it('exports the same limits and required columns from both', () => {
    expect(server.REQUIRED_COLUMNS).toEqual(browser.REQUIRED_COLUMNS);
    expect(server.MAX_ROWS).toBe(browser.MAX_ROWS);
  });

  it.each([
    'name',
    'Item Name',
    'PRODUCT',
    'qty',
    'amount',
    'storage_location',
    'where',
    'shelf-life-days',
    'Best By',
    'Use By',
    'cost',
    'retailer',
    'aisle',
    '',
    '  ',
    'name ',
  ])('canonicalises the header "%s" the same way', (header) => {
    expect(server.canonicalHeader(header)).toBe(browser.canonicalHeader(header));
  });

  it.each(['Main Fridge', 'main  fridge', 'FRIDGE', 'chiller', 'deep freeze', 'nowhere', ''])(
    'resolves the location "%s" the same way',
    (value) => {
      const fromBrowser = browser.resolveLocation(value, LOCATIONS);
      const fromServer = server.resolveLocation(value, LOCATIONS);

      expect(fromServer?.id ?? null).toBe(fromBrowser?.id ?? null);
    }
  );

  it('agrees on the sample file the importer offers as an example', () => {
    const fromBrowser = browser.validateCSV(browser.SAMPLE_CSV, LOCATIONS);
    const fromServer = server.validateCSV(browser.SAMPLE_CSV, LOCATIONS);

    expect(summarise(fromServer)).toEqual(summarise(fromBrowser));
    expect(fromBrowser.errorRows).toHaveLength(0);
  });
});
