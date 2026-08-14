/**
 * Server-side CSV validation. The browser validates first, but the function is
 * reachable over HTTP by scripts and integrations, so it has to hold the same
 * line on its own: no row reaches Firestore that the security rules would
 * reject once step 10.2 turns production rules on.
 */

const {
  canonicalHeader,
  parseCSVText,
  resolveLocation,
  validateRow,
  validateCSV,
  REQUIRED_COLUMNS,
  MAX_ROWS,
} = require('../csvValidation');

const LOCATIONS = [
  { id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' },
  { id: 'loc-freezer', label: 'Garage Freezer', type: 'freezer' },
  { id: 'loc-pantry', label: 'Pantry', type: 'pantry' },
];

const HEADER = 'name,quantity,unit,location';
const csv = (...lines) => lines.join('\n');

describe('canonicalHeader', () => {
  it.each([
    ['Name', 'name'],
    ['ITEM', 'name'],
    ['Qty', 'quantity'],
    ['Storage Location', 'location'],
    ['shelf_life_days', 'shelfLifeDays'],
    ['Best By', 'expiresAt'],
    ['aisle', ''],
  ])('maps "%s" to "%s"', (input, expected) => {
    expect(canonicalHeader(input)).toBe(expected);
  });
});

describe('parseCSVText', () => {
  it('keys rows by canonical column name and skips blank lines', () => {
    const { rows, headers } = parseCSVText(csv(HEADER, 'Milk,1,gal,Main Fridge', '', '  '));

    expect(headers).toEqual(['name', 'quantity', 'unit', 'location']);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Milk');
  });

  it('returns nothing for empty input', () => {
    expect(parseCSVText('')).toEqual({ rows: [], headers: [], parseErrors: [] });
  });
});

describe('resolveLocation', () => {
  it('matches on label first, then on location type', () => {
    expect(resolveLocation('main fridge', LOCATIONS).id).toBe('loc-fridge');
    expect(resolveLocation('Freezer', LOCATIONS).id).toBe('loc-freezer');
    expect(resolveLocation('cupboard', LOCATIONS).id).toBe('loc-pantry');
  });

  it('returns null for a location this account does not have', () => {
    expect(resolveLocation('Wine Cellar', LOCATIONS)).toBeNull();
    expect(resolveLocation('', LOCATIONS)).toBeNull();
  });
});

describe('validateRow', () => {
  const row = (overrides) =>
    Object.assign({ name: 'Milk', quantity: '1', unit: 'gal', location: 'Main Fridge' }, overrides);

  it('maps a good row onto the inventory document fields', () => {
    const result = validateRow(row({ notes: 'organic', price: '$4.99' }), 2, LOCATIONS);

    expect(result.valid).toBe(true);
    expect(result.data).toMatchObject({
      name: 'Milk',
      normalized: 'milk',
      quantity: 1,
      locationId: 'loc-fridge',
      locationType: 'fridge',
      notes: 'organic',
      price: 4.99,
    });
  });

  it.each([
    [{ name: '' }, /Missing item name/],
    [{ quantity: '' }, /Missing quantity/],
    [{ quantity: 'lots' }, /not a number/],
    [{ quantity: '0' }, /greater than 0/],
    [{ location: 'Wine Cellar' }, /No storage location/],
    [{ shelfLifeDays: '-3' }, /positive number of days/],
    [{ expiresAt: 'someday' }, /not a date/],
    [{ price: 'free' }, /not an amount/],
  ])('rejects %o', (overrides, expected) => {
    const result = validateRow(row(overrides), 2, LOCATIONS);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
    expect(result.data).toBeNull();
  });

  it('reads a thousands separator as one number', () => {
    expect(validateRow(row({ quantity: '1,200' }), 2, LOCATIONS).data.quantity).toBe(1200);
  });
});

describe('validateCSV', () => {
  it('splits a mixed file into rows to import and rows to skip', () => {
    const result = validateCSV(
      csv(HEADER, 'Milk,1,gal,Main Fridge', ',2,lbs,Pantry', 'Rice,5,lbs,Pantry'),
      LOCATIONS
    );

    expect(result.fileError).toBeNull();
    expect(result.validRows.map((r) => r.data.name)).toEqual(['Milk', 'Rice']);
    expect(result.errorRows).toHaveLength(1);
    expect(result.errorRows[0].row).toBe(3);
  });

  it.each(REQUIRED_COLUMNS)('refuses a file with no %s column', (column) => {
    const headers = REQUIRED_COLUMNS.filter((c) => c !== column).join(',');
    const values = REQUIRED_COLUMNS.filter((c) => c !== column)
      .map(() => '1')
      .join(',');

    expect(validateCSV(csv(headers, values), LOCATIONS).fileError).toMatch(
      new RegExp(`needs a ${column}`)
    );
  });

  it('refuses an empty payload and a headings-only file', () => {
    expect(validateCSV('', LOCATIONS).fileError).toMatch(/empty/);
    expect(validateCSV(HEADER, LOCATIONS).fileError).toMatch(/no rows/);
  });

  it('refuses an account with no storage locations to import into', () => {
    expect(validateCSV(csv(HEADER, 'Milk,1,gal,Fridge'), []).fileError).toMatch(
      /no storage locations/
    );
  });

  it('refuses a payload past the row limit', () => {
    const rows = new Array(MAX_ROWS + 1).fill('Item,1,ea,Pantry');

    expect(validateCSV(csv(HEADER, ...rows), LOCATIONS).fileError).toMatch(
      new RegExp(`${MAX_ROWS} rows or fewer`)
    );
  });

  it('validates a large file — 600 rows, 6 of them broken', () => {
    const rows = Array.from({ length: 600 }, (_, i) =>
      i % 100 === 3 ? `Broken ${i},,ea,Pantry` : `Item ${i},1,ea,Pantry`
    );

    const result = validateCSV(csv(HEADER, ...rows), LOCATIONS);

    expect(result.totalRows).toBe(600);
    expect(result.validRows).toHaveLength(594);
    expect(result.errorRows).toHaveLength(6);
  });
});
