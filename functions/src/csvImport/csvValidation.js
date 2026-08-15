// functions/src/csvImport/csvValidation.js
// Server-side CSV parsing and validation for roadmap step 3.3.
//
// This mirrors src/components/CSVImport/csvValidation.js — the browser and the
// Cloud Function are separate npm packages, so the rules live in both places
// and are covered by tests in both. Any change to the accepted columns, the
// location matching or the row limits belongs in both files.
//
// Drift between the two is a bug, not a merge problem: a row the browser
// accepts and the function rejects is impossible to explain to a person. The
// contract test at src/components/CSVImport/__tests__/csvValidation.contract.test.js
// runs one corpus of files through both implementations and fails if any row's
// verdict or normalised output differs.
//
// A validated row maps 1:1 onto the inventory document firestore.rules
// requires: name, normalized, quantity, unit, locationId, locationType,
// addedAt and source: 'csv-import'.

const Papa = require('papaparse');

const REQUIRED_COLUMNS = ['name', 'quantity', 'location'];
const MAX_ROWS = 5000;
const MAX_NAME_LENGTH = 80;
const MAX_NOTES_LENGTH = 200;
const MAX_QUANTITY = 1000000;
const MAX_SHELF_LIFE_DAYS = 3650;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const HEADER_ALIASES = {
  name: 'name',
  item: 'name',
  itemname: 'name',
  product: 'name',
  ingredient: 'name',

  quantity: 'quantity',
  qty: 'quantity',
  amount: 'quantity',
  count: 'quantity',

  unit: 'unit',
  units: 'unit',
  measure: 'unit',
  uom: 'unit',

  location: 'location',
  storagelocation: 'location',
  storage: 'location',
  where: 'location',

  notes: 'notes',
  note: 'notes',
  comment: 'notes',
  comments: 'notes',

  shelflifedays: 'shelfLifeDays',
  shelflife: 'shelfLifeDays',
  daystoexpiry: 'shelfLifeDays',

  expiresat: 'expiresAt',
  expires: 'expiresAt',
  expiration: 'expiresAt',
  expirationdate: 'expiresAt',
  expiry: 'expiresAt',
  expirydate: 'expiresAt',
  bestby: 'expiresAt',
  useby: 'expiresAt',

  price: 'price',
  cost: 'price',
  paid: 'price',

  store: 'store',
  shop: 'store',
  vendor: 'store',
  retailer: 'store',
};

const TYPE_KEYWORDS = {
  fridge: 'fridge',
  refrigerator: 'fridge',
  chiller: 'fridge',
  freezer: 'freezer',
  deepfreeze: 'freezer',
  pantry: 'pantry',
  cupboard: 'pantry',
  cabinet: 'pantry',
  shelf: 'pantry',
};

// Placeholder name given to columns we don't understand, so they are dropped
// rather than colliding with each other.
const IGNORED_PREFIX = '__ignored_';

/** Collapse every run of whitespace to one space. A cell is one line of text. */
const squash = (value) =>
  String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();

/** Squash a header to its canonical name, or '' when we don't recognise it. */
const canonicalHeader = (header) =>
  HEADER_ALIASES[squash(header).toLowerCase().replace(/[\s_\-.]+/g, '')] || '';

/**
 * Decide what each column of the header row means.
 *
 * A column we don't understand — and a second column meaning the same thing as
 * an earlier one, which is what a file carrying both "item" and "product"
 * gives us — gets a throwaway name and is dropped. First spelling wins.
 */
const planHeaders = (rawHeaders) => {
  const claimed = new Set();

  return rawHeaders.map((raw, index) => {
    const canonical = canonicalHeader(raw);
    if (!canonical || claimed.has(canonical)) return `${IGNORED_PREFIX}${index}`;
    claimed.add(canonical);
    return canonical;
  });
};

/** Zip one row of values onto the planned column names. */
const buildRow = (fields, values) => {
  const row = {};
  fields.forEach((field, index) => {
    row[field] = values[index] === undefined ? '' : values[index];
  });
  // Values past the last column: a stray comma, or a row from a wider file.
  if (values.length > fields.length) row.__parsed_extra = values.slice(fields.length);
  return row;
};

const isBlankRow = (values) => values.every((value) => squash(value) === '');

/**
 * Parse raw CSV text into header-keyed rows.
 *
 * Unknown columns are dropped. Blank lines are dropped too, but only after the
 * line each row came from has been recorded in `lines`, so an error can name
 * the line the person sees in their spreadsheet.
 *
 * PapaParse's own `header: true` mode is deliberately not used: it resolves
 * columns that collide after our aliasing by renaming them, which depends on
 * how many times it happens to call `transformHeader`.
 */
const parseCSVText = (text) => {
  const source = String(text === undefined || text === null ? '' : text).trim();

  if (!source) {
    return { rows: [], headers: [], lines: [], parseErrors: [] };
  }

  const parsed = Papa.parse(source, { skipEmptyLines: false });
  const fields = planHeaders(parsed.data[0] || []);

  const rows = [];
  const lines = [];

  parsed.data.slice(1).forEach((values, index) => {
    if (isBlankRow(values)) return;
    rows.push(buildRow(fields, values));
    // +2: line 1 is the header, and spreadsheet lines are 1-based. A field
    // holding a quoted line break shifts everything after it by a line.
    lines.push(index + 2);
  });

  return {
    rows: rows,
    headers: fields.filter((field) => field && field.indexOf(IGNORED_PREFIX) !== 0),
    lines: lines,
    parseErrors: parsed.errors || [],
  };
};

const cell = (row, key) => squash(row ? row[key] : undefined);

const toNumber = (raw) => Number(String(raw).replace(/[$,\s]/g, ''));

const buildLocationIndex = (locations) => {
  const byLabel = new Map();
  const byType = new Map();

  locations.forEach((location) => {
    if (location && location.label) {
      byLabel.set(squash(location.label).toLowerCase(), location);
    }
    if (location && location.type && !byType.has(location.type)) {
      byType.set(location.type, location);
    }
  });

  return { byLabel, byType };
};

/** Match a location cell against the user's own locations, then by type. */
const resolveLocation = (value, locations) => {
  const wanted = squash(value).toLowerCase();
  if (!wanted) return null;

  const index = buildLocationIndex(locations || []);
  const byExactLabel = index.byLabel.get(wanted);
  if (byExactLabel) return byExactLabel;

  const type = TYPE_KEYWORDS[wanted.replace(/[\s_\-.]+/g, '')];
  return type ? index.byType.get(type) || null : null;
};

/** Validate one parsed row. Returns { row, valid, errors, data, raw }. */
const validateRow = (row, rowNumber, locations) => {
  const errors = [];

  // A trailing comma leaves an empty extra value on every row of some exports;
  // only values with something in them mean the row is really misaligned.
  const extra = (row && row.__parsed_extra) || [];
  if (extra.some((value) => squash(value) !== '')) {
    errors.push('More values than there are columns — check for a stray comma.');
  }

  let name = cell(row, 'name');
  if (!name) {
    errors.push('Missing item name.');
  } else if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH);
  }

  const rawQuantity = cell(row, 'quantity');
  const quantity = toNumber(rawQuantity);
  if (!rawQuantity) {
    errors.push('Missing quantity.');
  } else if (!Number.isFinite(quantity)) {
    errors.push(`Quantity "${rawQuantity}" is not a number.`);
  } else if (quantity <= 0) {
    errors.push('Quantity must be greater than 0.');
  } else if (quantity > MAX_QUANTITY) {
    errors.push(`Quantity ${quantity} looks wrong — the limit is ${MAX_QUANTITY}.`);
  }

  const rawLocation = cell(row, 'location');
  const location = resolveLocation(rawLocation, locations);
  if (!rawLocation) {
    errors.push('Missing storage location.');
  } else if (!location) {
    errors.push(`No storage location called "${rawLocation}".`);
  }

  const rawShelfLife = cell(row, 'shelfLifeDays');
  let shelfLifeDays = null;
  if (rawShelfLife) {
    const days = toNumber(rawShelfLife);
    if (!Number.isFinite(days) || days <= 0) {
      errors.push(`Shelf life "${rawShelfLife}" must be a positive number of days.`);
    } else if (days > MAX_SHELF_LIFE_DAYS) {
      errors.push(`Shelf life ${days} days is longer than the ${MAX_SHELF_LIFE_DAYS}-day limit.`);
    } else {
      shelfLifeDays = Math.round(days);
    }
  }

  const rawExpires = cell(row, 'expiresAt');
  let expiresAt = null;
  if (rawExpires) {
    const parsed = new Date(rawExpires);
    if (Number.isNaN(parsed.getTime())) {
      errors.push(`Expiry date "${rawExpires}" is not a date we can read.`);
    } else if (parsed.getTime() > Date.now() + MAX_SHELF_LIFE_DAYS * MS_PER_DAY) {
      // A spreadsheet that exported dates as serial numbers puts "45678" here,
      // which Date reads as the year 45678. Same limit as shelf life, so the
      // two columns can't disagree about how far ahead is believable.
      errors.push(
        `Expiry date "${rawExpires}" is more than ${MAX_SHELF_LIFE_DAYS} days away — check that column.`
      );
    } else {
      expiresAt = parsed;
    }
  }

  const rawPrice = cell(row, 'price');
  let price = null;
  if (rawPrice) {
    const parsed = toNumber(rawPrice);
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.push(`Price "${rawPrice}" is not an amount.`);
    } else {
      price = parsed;
    }
  }

  if (errors.length > 0) {
    return { row: rowNumber, valid: false, errors, data: null, raw: row };
  }

  return {
    row: rowNumber,
    valid: true,
    errors: [],
    raw: row,
    data: {
      name,
      normalized: name.toLowerCase(),
      quantity,
      unit: cell(row, 'unit'),
      locationId: location.id,
      locationType: location.type,
      locationLabel: location.label,
      notes: cell(row, 'notes').slice(0, MAX_NOTES_LENGTH),
      shelfLifeDays,
      expiresAt,
      price,
      store: cell(row, 'store'),
    },
  };
};

/**
 * Validate a whole CSV payload.
 *
 * `fileError` means nothing is importable — wrong columns, empty file, no
 * storage locations. Otherwise every row lands in validRows or errorRows with
 * the line number it came from.
 */
const validateCSV = (text, locations) => {
  const resolvedLocations = locations || [];
  const empty = { fileError: null, headers: [], validRows: [], errorRows: [], totalRows: 0 };

  if (!String(text === undefined || text === null ? '' : text).trim()) {
    return Object.assign({}, empty, { fileError: 'That file is empty.' });
  }

  if (!resolvedLocations.length) {
    return Object.assign({}, empty, {
      fileError: 'This account has no storage locations to import into.',
    });
  }

  const parsed = parseCSVText(text);
  const missing = REQUIRED_COLUMNS.filter((column) => !parsed.headers.includes(column));

  if (missing.length > 0) {
    return Object.assign({}, empty, {
      headers: parsed.headers,
      fileError: `The file needs a ${missing.join(', ')} column. Found: ${
        parsed.headers.length ? parsed.headers.join(', ') : 'no recognisable columns'
      }.`,
    });
  }

  if (parsed.rows.length === 0) {
    return Object.assign({}, empty, {
      headers: parsed.headers,
      fileError: 'That file has column headings but no rows.',
    });
  }

  if (parsed.rows.length > MAX_ROWS) {
    return Object.assign({}, empty, {
      headers: parsed.headers,
      fileError: `That file has ${parsed.rows.length} rows. Please split it into files of ${MAX_ROWS} rows or fewer.`,
    });
  }

  const validRows = [];
  const errorRows = [];

  parsed.rows.forEach((row, index) => {
    const validated = validateRow(row, parsed.lines[index], resolvedLocations);
    (validated.valid ? validRows : errorRows).push(validated);
  });

  return {
    fileError: null,
    headers: parsed.headers,
    validRows,
    errorRows,
    totalRows: parsed.rows.length,
  };
};

module.exports = {
  REQUIRED_COLUMNS,
  MAX_ROWS,
  canonicalHeader,
  parseCSVText,
  resolveLocation,
  validateRow,
  validateCSV,
};
