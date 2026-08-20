// src/config/storeSections.js
// Which aisle a shopping list line belongs to.
//
// A list ordered the way a supermarket is laid out is a list you walk once.
// Ordered by when a recipe happened to mention something, it is a list that
// sends you back across the shop for the milk you passed ten minutes ago.
//
// The sections are ordered the way most supermarkets are walked — produce at
// the door, frozen near the end, drinks on the way to the tills. Anything the
// table has never heard of falls to "Other", which sorts last: an unrecognised
// item is still on the list, just not filed.
//
// The ingredient map below was generated from the categories already grouped in
// `useIngredientMetadata.js`, so the two agree by construction rather than by
// anyone remembering. A test fails if an ingredient is added there without
// being filed here — see src/config/__tests__/storeSections.test.js. That is
// deliberate: silent drift between two ingredient lists is exactly the failure
// this project has hit before.

import { INGREDIENT_SHELF_LIFE } from '../hooks/useIngredientMetadata';

/** The aisles, in the order a shop is usually walked. */
export const STORE_SECTIONS = [
  { key: 'produce', label: 'Produce' },
  { key: 'bakery', label: 'Bakery' },
  { key: 'meat', label: 'Meat & Seafood' },
  { key: 'dairy', label: 'Dairy & Eggs' },
  { key: 'frozen', label: 'Frozen' },
  { key: 'pantry', label: 'Pantry' },
  { key: 'drinks', label: 'Drinks' },
  { key: 'other', label: 'Other' },
];

/** Section key -> its position in the walk. */
const ORDER = new Map(STORE_SECTIONS.map((section, index) => [section.key, index]));

/** Where an unrecognised item goes. */
export const FALLBACK_SECTION = 'other';

/**
 * Ingredient -> aisle.
 *
 * Generated from the groupings in useIngredientMetadata.js. "Leftovers" from
 * that table are deliberately absent: cooked rice and last night's stew are
 * things you have, not things you buy.
 */
export const INGREDIENT_SECTIONS = {
  // produce
  apples: 'produce',
  asparagus: 'produce',
  avocados: 'produce',
  bananas: 'produce',
  basil: 'produce',
  'bell peppers': 'produce',
  berries: 'produce',
  blueberries: 'produce',
  broccoli: 'produce',
  cabbage: 'produce',
  carrots: 'produce',
  cauliflower: 'produce',
  celery: 'produce',
  cilantro: 'produce',
  cucumbers: 'produce',
  garlic: 'produce',
  ginger: 'produce',
  grapes: 'produce',
  'green beans': 'produce',
  kale: 'produce',
  lemons: 'produce',
  lettuce: 'produce',
  limes: 'produce',
  mint: 'produce',
  mushrooms: 'produce',
  onions: 'produce',
  oranges: 'produce',
  parsley: 'produce',
  peaches: 'produce',
  pears: 'produce',
  potatoes: 'produce',
  rosemary: 'produce',
  spinach: 'produce',
  strawberries: 'produce',
  thyme: 'produce',
  tomatoes: 'produce',
  zucchini: 'produce',
  // bakery
  bread: 'bakery',
  tortillas: 'bakery',
  // meat
  bacon: 'meat',
  'chicken breast': 'meat',
  cod: 'meat',
  'cooked beef': 'meat',
  'cooked chicken': 'meat',
  'cooked pork': 'meat',
  crab: 'meat',
  'ground beef': 'meat',
  'ground turkey': 'meat',
  lamb: 'meat',
  'pork chops': 'meat',
  salmon: 'meat',
  sausage: 'meat',
  scallops: 'meat',
  shrimp: 'meat',
  steak: 'meat',
  tuna: 'meat',
  // dairy
  butter: 'dairy',
  cheese: 'dairy',
  'cottage cheese': 'dairy',
  cream: 'dairy',
  'cream cheese': 'dairy',
  'egg whites': 'dairy',
  'egg yolks': 'dairy',
  eggs: 'dairy',
  milk: 'dairy',
  'sour cream': 'dairy',
  yogurt: 'dairy',
  // frozen
  'frozen fruit': 'frozen',
  'frozen pizza': 'frozen',
  'frozen vegetables': 'frozen',
  'ice cream': 'frozen',
  // pantry
  almonds: 'pantry',
  'baking powder': 'pantry',
  'baking soda': 'pantry',
  'bbq sauce': 'pantry',
  'black pepper': 'pantry',
  'brown sugar': 'pantry',
  'canned beans': 'pantry',
  'canned tomatoes': 'pantry',
  'canned tuna': 'pantry',
  cashews: 'pantry',
  'chia seeds': 'pantry',
  'chili powder': 'pantry',
  cinnamon: 'pantry',
  couscous: 'pantry',
  cumin: 'pantry',
  'dried basil': 'pantry',
  'flax seeds': 'pantry',
  flour: 'pantry',
  honey: 'pantry',
  'hot sauce': 'pantry',
  jam: 'pantry',
  ketchup: 'pantry',
  'maple syrup': 'pantry',
  mayonnaise: 'pantry',
  mustard: 'pantry',
  oats: 'pantry',
  'olive oil': 'pantry',
  oregano: 'pantry',
  paprika: 'pantry',
  pasta: 'pantry',
  'peanut butter': 'pantry',
  peanuts: 'pantry',
  pickles: 'pantry',
  quinoa: 'pantry',
  rice: 'pantry',
  salsa: 'pantry',
  'soy sauce': 'pantry',
  sugar: 'pantry',
  'vanilla extract': 'pantry',
  'vegetable oil': 'pantry',
  walnuts: 'pantry',
  // Leftovers from the shelf-life table. Nobody puts last night's stew on a
  // shopping list, but "soup" typed into the box means the tinned kind, and
  // leaving them unfiled would mean the drift guard below could never be
  // absolute — two of their siblings ("cooked rice", "cooked pasta") already
  // land in pantry by keyword, so excluding the rest was arbitrary.
  casserole: 'pantry',
  soup: 'pantry',
  stew: 'pantry',
  pizza: 'frozen',

  // drinks
  'apple juice': 'drinks',
  beer: 'drinks',
  'orange juice': 'drinks',
  wine: 'drinks',
};

/**
 * Keyword rules for names the map has never seen — "chicken thighs", "frozen
 * peas", "sourdough loaf". Checked in order, first match wins, so the more
 * specific words come first: "frozen peas" is frozen, not produce.
 */
const KEYWORD_RULES = [
  [/\bfrozen\b|\bice cream\b/, 'frozen'],
  [/\bjuice\b|\bsoda\b|\bcoffee\b|\btea\b|\bbeer\b|\bwine\b|\bwater\b/, 'drinks'],
  [/\bbread\b|\bbagel|\bbun\b|\bbuns\b|\bloaf\b|\bcroissant|\bmuffin|\btortilla/, 'bakery'],
  [
    /\bchicken\b|\bbeef\b|\bpork\b|\blamb\b|\bturkey\b|\bbacon\b|\bsausage|\bmince\b|\bsteak\b/,
    'meat',
  ],
  [/\bfish\b|\bsalmon\b|\btuna\b|\bprawn|\bshrimp\b|\bcod\b|\bcrab\b|\bscallop/, 'meat'],
  [/\bmilk\b|\bcheese\b|\byogurt|\byoghurt|\bcream\b|\bbutter\b|\begg/, 'dairy'],
  [
    /\bcanned\b|\btinned\b|\bpasta\b|\brice\b|\bflour\b|\bsugar\b|\boil\b|\bspice|\bsauce\b/,
    'pantry',
  ],
];

/**
 * The aisle for an item name.
 *
 * @param {string} name  the item as the cook wrote it, or its normalized form
 * @returns {string} a key from STORE_SECTIONS
 */
export const sectionFor = (name) => {
  const normalized = String(name ?? '')
    .toLowerCase()
    .trim();
  if (!normalized) return FALLBACK_SECTION;

  const exact = INGREDIENT_SECTIONS[normalized];
  if (exact) return exact;

  // Singular and plural are the same errand. The inventory already treats them
  // as one food, so the aisle lookup has to as well or "eggs" files under
  // Dairy while "egg" falls to Other.
  const singular = normalized.replace(/s$/, '');
  if (INGREDIENT_SECTIONS[singular]) return INGREDIENT_SECTIONS[singular];
  if (INGREDIENT_SECTIONS[`${normalized}s`]) return INGREDIENT_SECTIONS[`${normalized}s`];

  const rule = KEYWORD_RULES.find(([pattern]) => pattern.test(normalized));
  return rule ? rule[1] : FALLBACK_SECTION;
};

/** Every ingredient the shelf-life table knows but this file has not filed. */
export const unfiledIngredients = () =>
  Object.keys(INGREDIENT_SHELF_LIFE).filter((name) => sectionFor(name) === FALLBACK_SECTION);

/**
 * Groups shopping lines into aisles, in walk order.
 *
 * Empty sections are dropped — a heading with nothing under it is noise on a
 * list you are holding in one hand.
 *
 * @param {Array<{name?: string, normalized?: string}>} items
 * @returns {Array<{key: string, label: string, items: Array}>}
 */
export const groupByStoreSection = (items = []) => {
  const buckets = new Map();

  items.forEach((item) => {
    const key = sectionFor(item?.normalized || item?.name);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });

  return [...buckets.entries()]
    .sort((a, b) => ORDER.get(a[0]) - ORDER.get(b[0]))
    .map(([key, sectionItems]) => ({
      key,
      label: STORE_SECTIONS.find((section) => section.key === key)?.label ?? 'Other',
      items: sectionItems,
    }));
};

export default groupByStoreSection;
