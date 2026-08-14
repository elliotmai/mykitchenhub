// functions/src/csvImport/csvValidation.js
// Server-side CSV parsing and validation for roadmap step 3.3.
//
// This mirrors src/components/CSVImport/csvValidation.js — the browser and the
// Cloud Function are separate npm packages, so the rules live in both places
// and are covered by tests in both. Any change to the accepted columns, the
// location matching or the row limits belongs in both files.
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

/** Squash a header to its canonical name, or '' when we don't recognise it. */
const canonicalHeader = (header) =>
  HEADER_ALIASES[
    String(header === undefined || header === null ? '' : header)
      .trim()
      .toLowerCase()
      .replace(/[\s_\-.]+/g, '')
  ] || '';

/** Parse raw CSV text into header-keyed rows. Unknown columns are ignored. */
const parseCSVText = (text) => {
  const source = String(text === undefined || text === null ? '' : text).trim();

  if (!source) {
    return { rows: [], headers: [], parseErrors: [] };
  }

  const parsed = Papa.parse(source, {
    header: true,
    skipEmptyLines: 'greedy',
    // Unknown columns get a unique throwaway name: two of them sharing one
    // name would make PapaParse warn about duplicate headers.
    transformHeader: (header, index) => canonicalHeader(header) || `${IGNORED_PREFIX}${index}`,
  });

  return {
    rows: parsed.data,
    headers: ((parsed.meta && parsed.meta.fields) || []).filter(
      (field) => field && field.indexOf(IGNORED_PREFIX) !== 0
    ),
    parseErrors: parsed.errors || [],
  };
};

const cell = (row, key) => {
  const value = row ? row[key] : undefined;
  return value === undefined || value === null ? '' : String(value).trim();
};

const toNumber = (raw) => Number(String(raw).replace(/[$,\s]/g, ''));

const buildLocationIndex = (locations) => {
  const byLabel = new Map();
  const byType = new Map();

  locations.forEach((location) => {
    if (location && location.label) {
      byLabel.set(String(location.label).trim().toLowerCase(), location);
    }
    if (location && location.type && !byType.has(location.type)) {
      byType.set(location.type, location);
    }
  });

  return { byLabel, byType };
};

/** Match a location cell against the user's own locations, then by type. */
const resolveLocation = (value, locations) => {
  const wanted = String(value === undefined || value === null ? '' : value)
    .trim()
    .toLowerCase();
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

  if (row && row.__parsed_extra) {
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
    // +2: line 1 is the header, and spreadsheet rows are 1-based.
    const validated = validateRow(row, index + 2, resolvedLocations);
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
