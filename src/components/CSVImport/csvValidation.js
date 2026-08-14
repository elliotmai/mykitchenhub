// src/components/CSVImport/csvValidation.js
// Parsing and validation for CSV bulk import — roadmap step 3.3.
//
// A spreadsheet exported from anywhere is messy: headers are capitalised
// differently, quantities arrive as "2 " or "1,200", locations are typed by
// hand. Everything here runs in the browser before a single document is
// written, so the person importing sees exactly which rows are good and what
// is wrong with the rest — no half-imported kitchen.
//
// The validated row shape maps 1:1 onto the inventory document the security
// rules require (see firestore/firestore.rules): name, normalized, quantity,
// unit, locationId, locationType, addedAt and source: 'csv-import'.
//
// functions/src/csvImport/csvValidation.js is the same logic in CommonJS, for
// the Cloud Function. The two are kept honest by the contract test in
// __tests__/csvValidation.contract.test.js, which runs one corpus of files
// through both and fails if they disagree about any row. Change one, change
// the other, in the same commit.

import Papa from 'papaparse';

/** Columns a file must contain to be importable at all. */
export const REQUIRED_COLUMNS = ['name', 'quantity', 'location'];

/** Every column we understand, in the order the help text lists them. */
export const KNOWN_COLUMNS = [
  'name',
  'quantity',
  'unit',
  'location',
  'notes',
  'shelfLifeDays',
  'expiresAt',
  'price',
  'store',
];

/** Refuse absurd files rather than locking up the browser. */
export const MAX_ROWS = 5000;

const MAX_NAME_LENGTH = 80;
const MAX_NOTES_LENGTH = 200;
const MAX_QUANTITY = 1_000_000;
const MAX_SHELF_LIFE_DAYS = 3650;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Header spellings we accept, keyed by their squashed lowercase form.
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

// Words people type into a "location" column when they mean a location *type*
// rather than one of their own labels.
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
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** Squash a header to its canonical name, or '' when we don't recognise it. */
export const canonicalHeader = (header) => {
  const key = squash(header)
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '');
  return HEADER_ALIASES[key] ?? '';
};

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
    row[field] = values[index] ?? '';
  });
  // Values past the last column: a stray comma, or a row from a wider file.
  if (values.length > fields.length) row.__parsed_extra = values.slice(fields.length);
  return row;
};

const isBlankRow = (values) => values.every((value) => squash(value) === '');

/**
 * Parse raw CSV text into header-keyed rows.
 *
 * Unrecognised columns are dropped, so a file carrying extra bookkeeping
 * columns still imports. Blank lines are dropped too, but only after the line
 * each row came from has been recorded in `lines` — the preview points people
 * at a line in their spreadsheet, so it has to be the line they actually see.
 *
 * PapaParse's own `header: true` mode is deliberately not used: it resolves
 * columns that collide after our aliasing by renaming them, which depends on
 * how many times it happens to call `transformHeader`.
 */
export const parseCSVText = (text) => {
  const source = String(text ?? '').trim();

  if (!source) {
    return { rows: [], headers: [], lines: [], parseErrors: [] };
  }

  const { data, errors } = Papa.parse(source, { skipEmptyLines: false });
  const fields = planHeaders(data[0] ?? []);

  const rows = [];
  const lines = [];

  data.slice(1).forEach((values, index) => {
    if (isBlankRow(values)) return;
    rows.push(buildRow(fields, values));
    // +2: line 1 is the header, and spreadsheet lines are 1-based. A field
    // holding a quoted line break shifts everything after it by a line.
    lines.push(index + 2);
  });

  return {
    rows,
    headers: fields.filter((field) => field && !field.startsWith(IGNORED_PREFIX)),
    lines,
    parseErrors: errors ?? [],
  };
};

// ---------------------------------------------------------------------------
// Field readers — each returns a value or pushes a human-readable problem
// ---------------------------------------------------------------------------

const cell = (row, key) => squash(row?.[key]);

const toNumber = (raw) => Number(String(raw).replace(/[$,\s]/g, ''));

const buildLocationIndex = (locations) => {
  const byLabel = new Map();
  const byType = new Map();

  locations.forEach((location) => {
    if (location?.label) byLabel.set(squash(location.label).toLowerCase(), location);
    // First location of each type wins, so "fridge" means the main fridge.
    if (location?.type && !byType.has(location.type)) byType.set(location.type, location);
  });

  return { byLabel, byType };
};

/**
 * Match a location cell against the user's own locations.
 *
 * Tries the exact label first ("Garage Freezer"), then falls back to the
 * location *type* ("freezer" → whichever freezer comes first).
 */
export const resolveLocation = (value, locations = []) => {
  const wanted = squash(value).toLowerCase();
  if (!wanted) return null;

  const { byLabel, byType } = buildLocationIndex(locations);

  const byExactLabel = byLabel.get(wanted);
  if (byExactLabel) return byExactLabel;

  const type = TYPE_KEYWORDS[wanted.replace(/[\s_\-.]+/g, '')];
  return type ? (byType.get(type) ?? null) : null;
};

/**
 * Validate one parsed row against the user's storage locations.
 *
 * @returns {{ row: number, valid: boolean, errors: string[], data: object|null, raw: object }}
 */
export const validateRow = (row, rowNumber, locations = []) => {
  const errors = [];

  // A trailing comma leaves an empty extra value on every row of some exports;
  // only values with something in them mean the row is really misaligned.
  if ((row?.__parsed_extra ?? []).some((value) => squash(value) !== '')) {
    errors.push('More values than there are columns — check for a stray comma.');
  }

  // Name
  let name = cell(row, 'name');
  if (!name) {
    errors.push('Missing item name.');
  } else if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH);
  }

  // Quantity
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

  // Location
  const rawLocation = cell(row, 'location');
  const location = resolveLocation(rawLocation, locations);
  if (!rawLocation) {
    errors.push('Missing storage location.');
  } else if (!location) {
    errors.push(`No storage location called "${rawLocation}".`);
  }

  // Shelf life (optional)
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

  // Explicit expiry date (optional)
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

  // Price (optional)
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
 * Validate a whole CSV file.
 *
 * A `fileError` means nothing can be imported — wrong columns, empty file, no
 * storage locations to import into. Otherwise every row lands in either
 * `validRows` or `errorRows`, both carrying their line number in the file so
 * the preview can point at the offending line.
 */
export const validateCSV = (text, locations = []) => {
  const empty = { fileError: null, headers: [], validRows: [], errorRows: [], totalRows: 0 };

  if (!String(text ?? '').trim()) {
    return { ...empty, fileError: 'That file is empty.' };
  }

  if (!locations.length) {
    return {
      ...empty,
      fileError: 'Add a storage location in Settings before importing a file.',
    };
  }

  const { rows, headers, lines } = parseCSVText(text);

  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    return {
      ...empty,
      headers,
      fileError: `The file needs a ${missing.join(', ')} column. Found: ${
        headers.length ? headers.join(', ') : 'no recognisable columns'
      }.`,
    };
  }

  if (rows.length === 0) {
    return { ...empty, headers, fileError: 'That file has column headings but no rows.' };
  }

  if (rows.length > MAX_ROWS) {
    return {
      ...empty,
      headers,
      fileError: `That file has ${rows.length} rows. Please split it into files of ${MAX_ROWS} rows or fewer.`,
    };
  }

  const validRows = [];
  const errorRows = [];

  rows.forEach((row, index) => {
    const validated = validateRow(row, lines[index], locations);
    (validated.valid ? validRows : errorRows).push(validated);
  });

  return { fileError: null, headers, validRows, errorRows, totalRows: rows.length };
};

/** Read a File/Blob as text. FileReader works in every browser we support. */
export const readFileText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'));
    reader.readAsText(file);
  });

/** A minimal example file, shown in the importer's help text. */
export const SAMPLE_CSV = [
  'name,quantity,unit,location,notes',
  'Whole Milk,1,gal,Main Fridge,',
  'Chicken Breast,2,lbs,Freezer,From Costco',
  'Basmati Rice,5,lbs,Pantry,',
].join('\n');
