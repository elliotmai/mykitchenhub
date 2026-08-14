// The gatekeeper for bulk import: everything that reaches Firestore comes
// through here, so these tests cover the messy spreadsheet a real person
// exports — odd capitalisation, blank lines, "1,200" quantities, a location
// column filled in from memory.

import {
  canonicalHeader,
  parseCSVText,
  resolveLocation,
  validateRow,
  validateCSV,
  readFileText,
  REQUIRED_COLUMNS,
  MAX_ROWS,
  SAMPLE_CSV,
} from '../csvValidation';
import { makeLocation } from '../../../test-utils/factories';

const LOCATIONS = [
  makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' }),
  makeLocation({ id: 'loc-freezer', label: 'Garage Freezer', type: 'freezer' }),
  makeLocation({ id: 'loc-pantry', label: 'Pantry', type: 'pantry' }),
];

const csv = (...lines) => lines.join('\n');

const HEADER = 'name,quantity,unit,location';

describe('canonicalHeader', () => {
  it.each([
    ['Name', 'name'],
    ['ITEM', 'name'],
    ['Item Name', 'name'],
    ['Qty', 'quantity'],
    ['  amount  ', 'quantity'],
    ['Storage Location', 'location'],
    ['shelf_life_days', 'shelfLifeDays'],
    ['Best By', 'expiresAt'],
  ])('maps %s to %s', (input, expected) => {
    expect(canonicalHeader(input)).toBe(expected);
  });

  it('returns an empty name for a column we do not understand', () => {
    expect(canonicalHeader('aisle')).toBe('');
    expect(canonicalHeader(undefined)).toBe('');
  });
});

describe('parseCSVText', () => {
  it('keys rows by canonical column name', () => {
    const { rows, headers } = parseCSVText(csv(HEADER, 'Milk,1,gal,Main Fridge'));

    expect(headers).toEqual(['name', 'quantity', 'unit', 'location']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Milk', quantity: '1', location: 'Main Fridge' });
  });

  it('skips blank lines rather than treating them as rows', () => {
    const { rows } = parseCSVText(csv(HEADER, 'Milk,1,gal,Main Fridge', '', '   ', ''));
    expect(rows).toHaveLength(1);
  });

  it('keeps quoted commas inside a single field', () => {
    const { rows } = parseCSVText(
      csv('name,quantity,unit,location,notes', 'Milk,1,gal,Main Fridge,"organic, from Costco"')
    );

    expect(rows[0].notes).toBe('organic, from Costco');
  });

  it('returns nothing for empty input', () => {
    expect(parseCSVText('   ')).toEqual({ rows: [], headers: [], parseErrors: [] });
  });
});

describe('resolveLocation', () => {
  it('matches a location by its label, ignoring case and padding', () => {
    expect(resolveLocation('  main fridge ', LOCATIONS).id).toBe('loc-fridge');
  });

  it('falls back to the first location of a named type', () => {
    expect(resolveLocation('freezer', LOCATIONS).id).toBe('loc-freezer');
    expect(resolveLocation('Refrigerator', LOCATIONS).id).toBe('loc-fridge');
    expect(resolveLocation('cupboard', LOCATIONS).id).toBe('loc-pantry');
  });

  it('returns null for a location the user does not have', () => {
    expect(resolveLocation('Wine Cellar', LOCATIONS)).toBeNull();
    expect(resolveLocation('', LOCATIONS)).toBeNull();
  });
});

describe('validateRow', () => {
  const row = (overrides = {}) => ({
    name: 'Milk',
    quantity: '1',
    unit: 'gal',
    location: 'Main Fridge',
    ...overrides,
  });

  it('maps a good row onto the inventory document fields', () => {
    const result = validateRow(
      row({ notes: 'organic', price: '$4.99', store: 'Costco' }),
      2,
      LOCATIONS
    );

    expect(result.valid).toBe(true);
    expect(result.row).toBe(2);
    expect(result.data).toMatchObject({
      name: 'Milk',
      normalized: 'milk',
      quantity: 1,
      unit: 'gal',
      locationId: 'loc-fridge',
      locationType: 'fridge',
      locationLabel: 'Main Fridge',
      notes: 'organic',
      price: 4.99,
      store: 'Costco',
    });
  });

  it('reads a thousands separator as one number', () => {
    expect(validateRow(row({ quantity: '1,200' }), 2, LOCATIONS).data.quantity).toBe(1200);
  });

  it.each([
    ['', 'Missing item name.'],
    ['   ', 'Missing item name.'],
  ])('rejects a blank name (%s)', (name, message) => {
    const result = validateRow(row({ name }), 2, LOCATIONS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(message);
  });

  it('trims an over-long name instead of rejecting the row', () => {
    const result = validateRow(row({ name: 'x'.repeat(120) }), 2, LOCATIONS);

    expect(result.valid).toBe(true);
    expect(result.data.name).toHaveLength(80);
  });

  it.each([
    ['', /Missing quantity/],
    ['lots', /not a number/],
    ['0', /greater than 0/],
    ['-2', /greater than 0/],
    ['9999999', /looks wrong/],
  ])('rejects quantity "%s"', (quantity, expected) => {
    const result = validateRow(row({ quantity }), 2, LOCATIONS);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });

  it('names the location it could not find', () => {
    const result = validateRow(row({ location: 'Wine Cellar' }), 4, LOCATIONS);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No storage location called "Wine Cellar".');
  });

  it('flags a missing location separately from an unknown one', () => {
    expect(validateRow(row({ location: '' }), 2, LOCATIONS).errors).toContain(
      'Missing storage location.'
    );
  });

  it('collects every problem in one pass, so one fix-up round is enough', () => {
    const result = validateRow({ name: '', quantity: 'x', location: 'Nowhere' }, 5, LOCATIONS);

    expect(result.errors).toHaveLength(3);
    expect(result.data).toBeNull();
  });

  it('accepts an explicit expiry date', () => {
    const result = validateRow(row({ expiresAt: '2027-01-15' }), 2, LOCATIONS);

    expect(result.valid).toBe(true);
    expect(result.data.expiresAt.getFullYear()).toBe(2027);
  });

  it('rejects an expiry date it cannot read', () => {
    const result = validateRow(row({ expiresAt: 'next tuesday-ish' }), 2, LOCATIONS);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not a date we can read/);
  });

  it.each([
    ['14', 14],
    ['14.4', 14],
  ])('accepts shelf life "%s"', (raw, expected) => {
    expect(validateRow(row({ shelfLifeDays: raw }), 2, LOCATIONS).data.shelfLifeDays).toBe(
      expected
    );
  });

  it.each(['0', '-5', 'ages', '5000'])('rejects shelf life "%s"', (shelfLifeDays) => {
    expect(validateRow(row({ shelfLifeDays }), 2, LOCATIONS).valid).toBe(false);
  });

  it('rejects a price that is not an amount', () => {
    expect(validateRow(row({ price: 'free' }), 2, LOCATIONS).valid).toBe(false);
    expect(validateRow(row({ price: '-3' }), 2, LOCATIONS).valid).toBe(false);
  });

  it('flags a row with more values than columns', () => {
    const result = validateRow({ ...row(), __parsed_extra: ['oops'] }, 2, LOCATIONS);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/stray comma/);
  });
});

describe('validateCSV', () => {
  it('splits a mixed file into rows to import and rows to fix', () => {
    const result = validateCSV(
      csv(
        HEADER,
        'Milk,1,gal,Main Fridge',
        ',2,lbs,Pantry',
        'Chicken,2,lbs,Garage Freezer',
        'Mystery,1,ea,Wine Cellar'
      ),
      LOCATIONS
    );

    expect(result.fileError).toBeNull();
    expect(result.totalRows).toBe(4);
    expect(result.validRows.map((r) => r.data.name)).toEqual(['Milk', 'Chicken']);
    expect(result.errorRows.map((r) => r.row)).toEqual([3, 5]);
  });

  it('numbers rows the way a spreadsheet does, header included', () => {
    const result = validateCSV(csv(HEADER, 'Milk,1,gal,Main Fridge', ',1,gal,Pantry'), LOCATIONS);

    expect(result.errorRows[0].row).toBe(3);
  });

  it.each(REQUIRED_COLUMNS)('refuses a file with no %s column', (column) => {
    const headers = REQUIRED_COLUMNS.filter((c) => c !== column).join(',');
    const values = REQUIRED_COLUMNS.filter((c) => c !== column)
      .map(() => '1')
      .join(',');

    const result = validateCSV(csv(headers, values), LOCATIONS);

    expect(result.fileError).toMatch(new RegExp(`needs a ${column}`));
    expect(result.validRows).toHaveLength(0);
  });

  it('says so when the file is empty or has only headings', () => {
    expect(validateCSV('', LOCATIONS).fileError).toMatch(/empty/);
    expect(validateCSV(HEADER, LOCATIONS).fileError).toMatch(/no rows/);
  });

  it('asks for a storage location before anything else', () => {
    const result = validateCSV(csv(HEADER, 'Milk,1,gal,Main Fridge'), []);

    expect(result.fileError).toMatch(/storage location/);
  });

  it('refuses a file past the row limit rather than freezing the browser', () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `Item ${i},1,ea,Pantry`);
    const result = validateCSV(csv(HEADER, ...rows), LOCATIONS);

    expect(result.fileError).toMatch(new RegExp(`${MAX_ROWS} rows or fewer`));
  });

  it('handles a large file — 150 items with 3 bad rows', () => {
    const rows = Array.from({ length: 150 }, (_, i) =>
      i % 50 === 7 ? `Broken ${i},,ea,Pantry` : `Item ${i},2,ea,Pantry`
    );

    const result = validateCSV(csv(HEADER, ...rows), LOCATIONS);

    expect(result.totalRows).toBe(150);
    expect(result.validRows).toHaveLength(147);
    expect(result.errorRows).toHaveLength(3);
    result.validRows.forEach((row) => expect(row.data.locationId).toBe('loc-pantry'));
  });

  it('imports the sample file shown in the importer', () => {
    const result = validateCSV(SAMPLE_CSV, [
      makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' }),
      makeLocation({ id: 'loc-freezer', label: 'Freezer', type: 'freezer' }),
      makeLocation({ id: 'loc-pantry', label: 'Pantry', type: 'pantry' }),
    ]);

    expect(result.fileError).toBeNull();
    expect(result.errorRows).toHaveLength(0);
    expect(result.validRows).toHaveLength(3);
  });
});

describe('readFileText', () => {
  it('reads a File as text', async () => {
    const file = new File([SAMPLE_CSV], 'kitchen.csv', { type: 'text/csv' });

    await expect(readFileText(file)).resolves.toBe(SAMPLE_CSV);
  });
});
