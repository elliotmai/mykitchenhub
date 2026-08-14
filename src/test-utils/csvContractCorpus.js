// One corpus of CSV files, run through both validation implementations by
// csvValidation.contract.test.js. Written in CommonJS so either side can load
// it: the browser copy is ESM, the Cloud Function copy is CJS.
//
// Add a case here whenever you touch either csvValidation.js. A file that
// exercises a rule in only one of them is a rule that can drift.

const LOCATIONS = [
  { id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' },
  { id: 'loc-freezer', label: 'Garage Freezer', type: 'freezer' },
  { id: 'loc-pantry', label: 'Pantry', type: 'pantry' },
];

const HEADER = 'name,quantity,unit,location';
const csv = (...lines) => lines.join('\n');

const repeat = (count, line) =>
  csv(HEADER, ...Array.from({ length: count }, (_, i) => line.replace('{i}', String(i))));

/** { name, text, locations } — `locations` defaults to the three above. */
const CASES = [
  // ── shape of the file ────────────────────────────────────────────────────
  { name: 'empty file', text: '' },
  { name: 'whitespace only', text: '   \n  \n' },
  { name: 'header only', text: HEADER },
  { name: 'no header at all', text: csv('Milk,1,gal,Main Fridge', 'Rice,2,lbs,Pantry') },
  { name: 'missing required column', text: csv('name,quantity', 'Milk,1') },
  { name: 'unknown columns only', text: csv('fruit,howmany', 'apples,3') },
  {
    name: 'extra unknown columns alongside known ones',
    text: csv(`${HEADER},aisle,sku`, 'Milk,1,gal,Main Fridge,dairy,00123'),
  },
  {
    name: 'two columns that mean the same thing',
    text: csv('name,item,quantity,location', 'Milk,Cheese,1,Pantry'),
  },
  {
    name: 'literally duplicated header',
    text: csv('name,name,quantity,location', 'Milk,Cheese,1,Pantry'),
  },
  {
    name: 'no storage locations to import into',
    text: csv(HEADER, 'Milk,1,gal,Main Fridge'),
    locations: [],
  },

  // ── line endings, encoding, punctuation ──────────────────────────────────
  {
    name: 'CRLF line endings',
    text: 'name,quantity,location\r\nMilk,1,Main Fridge\r\nRice,2,Pantry',
  },
  { name: 'UTF-8 BOM', text: '﻿name,quantity,location\nMilk,1,Main Fridge' },
  {
    name: 'blank lines between rows',
    text: csv(HEADER, 'Milk,1,gal,Main Fridge', '', 'Bad,,ea,Pantry', '', 'Rice,2,lbs,Pantry'),
  },
  { name: 'trailing comma on every row', text: csv(HEADER, 'Milk,1,gal,Main Fridge,') },
  { name: 'genuinely ragged rows', text: csv(HEADER, 'Milk,1', 'Rice,2,lbs,Pantry,oops,more') },
  {
    name: 'quoted commas and quotes',
    text: csv(`${HEADER},notes`, 'Milk,1,gal,Main Fridge,"organic, from ""the good shop"""'),
  },
  {
    name: 'quoted line break inside a field',
    text: csv(`${HEADER},notes`, '"Milk\nsemi",1,gal,Main Fridge,"two\nlines"'),
  },
  { name: 'semicolon delimited', text: csv('name;quantity;location', 'Milk;1;Main Fridge') },
  { name: 'tab delimited', text: 'name\tquantity\tlocation\nMilk\t1\tMain Fridge' },
  {
    name: 'emoji and accents',
    text: csv(HEADER, '🍎 Äpfel,3,kg,Pantry', 'Crème Fraîche,1,tub,Main Fridge'),
  },
  { name: 'replacement characters from non-UTF-8 bytes', text: csv(HEADER, '��,1,ea,Pantry') },
  { name: 'padded cells', text: csv(HEADER, '  Milk  ,  1  ,  gal  ,  Main Fridge  ') },

  // ── numbers ──────────────────────────────────────────────────────────────
  ...[
    '1',
    '0',
    '-2',
    '1.5',
    '0.0001',
    'lots',
    '1e5',
    '0x10',
    '$4',
    '1,200',
    '1 200',
    '1_000',
    '1000000',
    '1000001',
    '999999999999',
    'Infinity',
    'NaN',
    '',
    ' ',
  ].map((quantity) => ({
    name: `quantity "${quantity}"`,
    text: csv(HEADER, `Milk,${quantity},gal,Main Fridge`),
  })),

  // ── locations ────────────────────────────────────────────────────────────
  ...[
    'Main Fridge',
    'main fridge',
    '  MAIN   FRIDGE  ',
    'fridge',
    'Refrigerator',
    'freezer',
    'deep freeze',
    'cupboard',
    'Wine Cellar',
    '',
    'Pantry ',
  ].map((location) => ({
    name: `location "${location}"`,
    text: csv(HEADER, `Milk,1,gal,${location}`),
  })),
  {
    name: 'location type when the user has two of that type',
    text: csv(HEADER, 'Milk,1,gal,fridge'),
    locations: [
      { id: 'loc-b', label: 'Beer Fridge', type: 'fridge' },
      { id: 'loc-a', label: 'Main Fridge', type: 'fridge' },
    ],
  },
  {
    name: 'location with no label at all',
    text: csv(HEADER, 'Milk,1,gal,Pantry'),
    locations: [{ id: 'loc-x', type: 'pantry' }],
  },

  // ── optional columns ─────────────────────────────────────────────────────
  ...['2027-01-15', '01/15/2027', '15/01/2027', 'someday', '0', '45678', '2020-01-01'].map(
    (expiresAt) => ({
      name: `expiry "${expiresAt}"`,
      text: csv(`${HEADER},expiresAt`, `Milk,1,gal,Main Fridge,${expiresAt}`),
    })
  ),
  ...['14', '14.4', '0', '-5', 'ages', '3650', '3651'].map((shelfLifeDays) => ({
    name: `shelf life "${shelfLifeDays}"`,
    text: csv(`${HEADER},shelfLifeDays`, `Milk,1,gal,Main Fridge,${shelfLifeDays}`),
  })),
  ...['4.99', '$4.99', '0', '-3', 'free'].map((price) => ({
    name: `price "${price}"`,
    text: csv(`${HEADER},price`, `Milk,1,gal,Main Fridge,${price}`),
  })),
  {
    name: 'every optional column at once',
    text: csv(
      'Item Name,Qty,UOM,Storage Location,Comment,Shelf Life,Best By,Cost,Shop',
      'Whole Milk,2,gal,main fridge,organic,10,2027-01-15,$4.99,Costco'
    ),
  },
  {
    name: 'over-long name and notes',
    text: csv(`${HEADER},notes`, `${'x'.repeat(120)},1,gal,Pantry,${'n'.repeat(300)}`),
  },

  // ── scale ────────────────────────────────────────────────────────────────
  { name: '499 rows', text: repeat(499, 'Item {i},1,ea,Pantry') },
  { name: '500 rows', text: repeat(500, 'Item {i},1,ea,Pantry') },
  { name: '501 rows', text: repeat(501, 'Item {i},1,ea,Pantry') },
  { name: '1000 rows', text: repeat(1000, 'Item {i},2,ea,Main Fridge') },
  { name: '5000 rows — the limit', text: repeat(5000, 'Item {i},1,ea,Pantry') },
  { name: '5001 rows — over the limit', text: repeat(5001, 'Item {i},1,ea,Pantry') },
  {
    name: 'mixed good and bad rows',
    text: csv(
      HEADER,
      'Milk,1,gal,Main Fridge',
      ',2,lbs,Pantry',
      'Chicken,2,lbs,Garage Freezer',
      'Mystery,1,ea,Wine Cellar',
      'Cheese,0,block,Main Fridge'
    ),
  },
];

module.exports = { CASES, LOCATIONS, HEADER, csv };
