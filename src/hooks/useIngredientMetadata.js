// React hook for ingredient metadata and expiration calculations
// Use this in your frontend to access shelf life data

import { useMemo } from 'react';

// Ingredient shelf life data (same as backend)
// The table below is generated from functions/src/data/ingredientShelfLife.js,
// the backend copy. A test in the functions suite compares the two entry by
// entry and fails if they drift, so edit the backend file and re-copy rather
// than editing this one in place.
const ingredientShelfLife = {
  // Dairy Products
  milk: { fridge: 7, freezer: 90, pantry: null },
  butter: { fridge: 90, freezer: 365, pantry: null },
  cheese: { fridge: 21, freezer: 180, pantry: null },
  yogurt: { fridge: 14, freezer: 60, pantry: null },
  cream: { fridge: 7, freezer: 120, pantry: null },
  'sour cream': { fridge: 14, freezer: 60, pantry: null },
  'cottage cheese': { fridge: 10, freezer: 90, pantry: null },
  'cream cheese': { fridge: 14, freezer: 60, pantry: null },

  // Eggs
  eggs: { fridge: 35, freezer: 365, pantry: null },
  'egg whites': { fridge: 4, freezer: 365, pantry: null },
  'egg yolks': { fridge: 2, freezer: 365, pantry: null },

  // Meat - Raw
  'chicken breast': { fridge: 2, freezer: 270, pantry: null },
  'ground beef': { fridge: 2, freezer: 120, pantry: null },
  steak: { fridge: 3, freezer: 180, pantry: null },
  'pork chops': { fridge: 3, freezer: 180, pantry: null },
  'ground turkey': { fridge: 2, freezer: 120, pantry: null },
  bacon: { fridge: 7, freezer: 30, pantry: null },
  sausage: { fridge: 2, freezer: 60, pantry: null },
  lamb: { fridge: 3, freezer: 270, pantry: null },

  // Meat - Cooked
  'cooked chicken': { fridge: 4, freezer: 120, pantry: null },
  'cooked beef': { fridge: 4, freezer: 90, pantry: null },
  'cooked pork': { fridge: 4, freezer: 90, pantry: null },

  // Seafood
  salmon: { fridge: 2, freezer: 90, pantry: null },
  shrimp: { fridge: 2, freezer: 180, pantry: null },
  tuna: { fridge: 2, freezer: 90, pantry: null },
  cod: { fridge: 2, freezer: 180, pantry: null },
  scallops: { fridge: 2, freezer: 90, pantry: null },
  crab: { fridge: 2, freezer: 90, pantry: null },

  // Vegetables - Fresh
  lettuce: { fridge: 7, freezer: null, pantry: null },
  spinach: { fridge: 7, freezer: 365, pantry: null },
  carrots: { fridge: 21, freezer: 365, pantry: null },
  broccoli: { fridge: 7, freezer: 365, pantry: null },
  'bell peppers': { fridge: 7, freezer: 180, pantry: null },
  tomatoes: { fridge: 7, freezer: 60, pantry: 3 },
  onions: { fridge: 60, freezer: 180, pantry: 30 },
  garlic: { fridge: 90, freezer: 365, pantry: 60 },
  potatoes: { fridge: 21, freezer: 365, pantry: 60 },
  celery: { fridge: 14, freezer: 365, pantry: null },
  cucumbers: { fridge: 7, freezer: null, pantry: null },
  mushrooms: { fridge: 7, freezer: 365, pantry: null },
  zucchini: { fridge: 7, freezer: 90, pantry: null },
  cauliflower: { fridge: 7, freezer: 365, pantry: null },
  'green beans': { fridge: 7, freezer: 365, pantry: null },
  asparagus: { fridge: 4, freezer: 365, pantry: null },
  kale: { fridge: 7, freezer: 365, pantry: null },
  cabbage: { fridge: 21, freezer: 365, pantry: null },

  // Fruits
  apples: { fridge: 30, freezer: 365, pantry: 7 },
  bananas: { fridge: 7, freezer: 90, pantry: 5 },
  oranges: { fridge: 21, freezer: 120, pantry: 7 },
  strawberries: { fridge: 7, freezer: 365, pantry: null },
  blueberries: { fridge: 14, freezer: 365, pantry: null },
  grapes: { fridge: 7, freezer: 365, pantry: null },
  lemons: { fridge: 21, freezer: 120, pantry: 7 },
  limes: { fridge: 21, freezer: 120, pantry: 7 },
  avocados: { fridge: 7, freezer: 180, pantry: 3 },
  berries: { fridge: 7, freezer: 365, pantry: null },
  peaches: { fridge: 7, freezer: 365, pantry: 3 },
  pears: { fridge: 21, freezer: 365, pantry: 7 },

  // Bread & Grains
  bread: { fridge: 7, freezer: 90, pantry: 5 },
  tortillas: { fridge: 14, freezer: 180, pantry: 7 },
  rice: { fridge: null, freezer: null, pantry: 730 },
  pasta: { fridge: null, freezer: null, pantry: 730 },
  flour: { fridge: null, freezer: 365, pantry: 180 },
  oats: { fridge: null, freezer: null, pantry: 365 },
  quinoa: { fridge: null, freezer: null, pantry: 730 },
  couscous: { fridge: null, freezer: null, pantry: 365 },

  // Condiments & Sauces (unopened vs opened)
  ketchup: { fridge: 180, freezer: null, pantry: 365 },
  mustard: { fridge: 180, freezer: null, pantry: 365 },
  mayonnaise: { fridge: 60, freezer: null, pantry: 120 },
  'soy sauce': { fridge: 730, freezer: null, pantry: 730 },
  'hot sauce': { fridge: 180, freezer: null, pantry: 365 },
  salsa: { fridge: 30, freezer: null, pantry: 365 },
  'bbq sauce': { fridge: 120, freezer: null, pantry: 365 },
  'olive oil': { fridge: null, freezer: null, pantry: 365 },
  'vegetable oil': { fridge: null, freezer: null, pantry: 365 },

  // Canned & Jarred
  'canned tomatoes': { fridge: 5, freezer: null, pantry: 730 },
  'canned beans': { fridge: 4, freezer: null, pantry: 730 },
  'canned tuna': { fridge: 4, freezer: null, pantry: 1095 },
  'peanut butter': { fridge: 180, freezer: null, pantry: 365 },
  jam: { fridge: 180, freezer: null, pantry: 365 },
  pickles: { fridge: 90, freezer: null, pantry: 365 },

  // Nuts & Seeds
  almonds: { fridge: 365, freezer: 730, pantry: 180 },
  walnuts: { fridge: 180, freezer: 365, pantry: 90 },
  peanuts: { fridge: 365, freezer: 730, pantry: 180 },
  cashews: { fridge: 180, freezer: 365, pantry: 90 },
  'chia seeds': { fridge: 730, freezer: 730, pantry: 365 },
  'flax seeds': { fridge: 365, freezer: 730, pantry: 180 },

  // Beverages
  'orange juice': { fridge: 7, freezer: 365, pantry: null },
  'apple juice': { fridge: 7, freezer: 365, pantry: null },
  wine: { fridge: 5, freezer: null, pantry: 1095 },
  beer: { fridge: 180, freezer: null, pantry: 180 },

  // Herbs & Spices (fresh)
  basil: { fridge: 7, freezer: 180, pantry: null },
  cilantro: { fridge: 7, freezer: 180, pantry: null },
  parsley: { fridge: 7, freezer: 180, pantry: null },
  rosemary: { fridge: 14, freezer: 180, pantry: null },
  thyme: { fridge: 14, freezer: 180, pantry: null },
  mint: { fridge: 7, freezer: 180, pantry: null },
  ginger: { fridge: 21, freezer: 180, pantry: null },

  // Dried Herbs & Spices
  'dried basil': { fridge: null, freezer: null, pantry: 730 },
  'black pepper': { fridge: null, freezer: null, pantry: 1095 },
  cumin: { fridge: null, freezer: null, pantry: 1095 },
  paprika: { fridge: null, freezer: null, pantry: 730 },
  oregano: { fridge: null, freezer: null, pantry: 730 },
  cinnamon: { fridge: null, freezer: null, pantry: 1095 },
  'chili powder': { fridge: null, freezer: null, pantry: 730 },

  // Baking
  sugar: { fridge: null, freezer: null, pantry: 1825 },
  'brown sugar': { fridge: null, freezer: null, pantry: 365 },
  'baking powder': { fridge: null, freezer: null, pantry: 365 },
  'baking soda': { fridge: null, freezer: null, pantry: 730 },
  'vanilla extract': { fridge: null, freezer: null, pantry: 1825 },
  honey: { fridge: null, freezer: null, pantry: 1825 },
  'maple syrup': { fridge: 365, freezer: null, pantry: 365 },

  // Frozen Foods
  'frozen vegetables': { fridge: null, freezer: 365, pantry: null },
  'frozen fruit': { fridge: null, freezer: 365, pantry: null },
  'ice cream': { fridge: null, freezer: 60, pantry: null },
  'frozen pizza': { fridge: null, freezer: 180, pantry: null },

  // Leftovers
  'cooked rice': { fridge: 4, freezer: 180, pantry: null },
  'cooked pasta': { fridge: 5, freezer: 60, pantry: null },
  soup: { fridge: 4, freezer: 90, pantry: null },
  stew: { fridge: 4, freezer: 90, pantry: null },
  casserole: { fridge: 4, freezer: 90, pantry: null },
  pizza: { fridge: 4, freezer: 60, pantry: null },
};

/**
 * The shelf-life table itself, for callers that are not React components.
 *
 * This file is the frontend's single copy — `functions/src/data/ingredientShelfLife.js`
 * is the backend's, and a test in the functions suite fails if the two ever
 * disagree. Import from here rather than starting a third copy.
 */
export const INGREDIENT_SHELF_LIFE = ingredientShelfLife;

/** Fallbacks for an ingredient the table has never heard of. */
const UNKNOWN_INGREDIENT_DEFAULTS = {
  fridge: 7,
  freezer: 90,
  pantry: 30,
};

/**
 * Raw table lookup, keeping the three outcomes distinguishable:
 *
 *   number     — the ingredient keeps for this many days in that location
 *   null       — the table knows the ingredient and says it does not belong there
 *                (lettuce in the freezer)
 *   undefined  — the table has never heard of it, so the caller picks a default
 *
 * `getShelfLife` below collapses `undefined` into a default; callers that need
 * to tell "don't freeze this" apart from "no idea" want this function instead.
 */
export const lookupShelfLife = (ingredientName, locationType) => {
  const key = String(ingredientName ?? '')
    .toLowerCase()
    .trim();
  const entry = INGREDIENT_SHELF_LIFE[key];

  if (!entry) return undefined;
  return entry[locationType];
};

/** Every ingredient the table knows, alphabetically. */
export const listIngredients = () => Object.keys(INGREDIENT_SHELF_LIFE).sort();

/** Ingredients whose name contains `searchTerm`. */
export const findIngredients = (searchTerm) => {
  const term = String(searchTerm ?? '')
    .toLowerCase()
    .trim();
  return listIngredients().filter((ingredient) => ingredient.includes(term));
};

/**
 * Custom hook for ingredient metadata
 */
export function useIngredientMetadata() {
  const getShelfLife = (ingredientName, locationType) => {
    const known = lookupShelfLife(ingredientName, locationType);
    if (known !== undefined) return known;

    return UNKNOWN_INGREDIENT_DEFAULTS[locationType] || 7;
  };

  const calculateExpirationDate = (ingredientName, locationType, purchaseDate = new Date()) => {
    const shelfLifeDays = getShelfLife(ingredientName, locationType);

    if (shelfLifeDays === null) {
      return null; // Item doesn't belong in this location
    }

    const expirationDate = new Date(purchaseDate);
    expirationDate.setDate(expirationDate.getDate() + shelfLifeDays);
    return expirationDate;
  };

  const getAllIngredients = listIngredients;
  const searchIngredients = findIngredients;

  const getDaysUntilExpiration = (expirationDate) => {
    if (!expirationDate) return null;

    const now = new Date();
    const expDate = new Date(expirationDate);
    const diffTime = expDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  };

  const getExpirationStatus = (expirationDate) => {
    const days = getDaysUntilExpiration(expirationDate);

    if (days === null) return 'unknown';
    if (days < 0) return 'expired';
    if (days === 0) return 'today';
    if (days <= 2) return 'urgent';
    if (days <= 7) return 'soon';
    return 'fresh';
  };

  const getExpirationColor = (expirationDate) => {
    const status = getExpirationStatus(expirationDate);

    const colors = {
      expired: '#dc3545', // red
      today: '#fd7e14', // orange
      urgent: '#ffc107', // yellow
      soon: '#28a745', // green
      fresh: '#28a745', // green
      unknown: '#6c757d', // gray
    };

    return colors[status] || colors.unknown;
  };

  return {
    getShelfLife,
    calculateExpirationDate,
    getAllIngredients,
    searchIngredients,
    getDaysUntilExpiration,
    getExpirationStatus,
    getExpirationColor,
    ingredientShelfLife,
  };
}

/**
 * Hook for autocomplete suggestions
 */
export function useIngredientAutocomplete(searchTerm) {
  // `findIngredients` is a module-level pure function, so the search term is
  // genuinely the only dependency — no stale-closure hazard, and no lint
  // warning to suppress. (CRA builds with CI=true treat warnings as errors.)
  const suggestions = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return [];
    return findIngredients(searchTerm).slice(0, 10); // Limit to 10 suggestions
  }, [searchTerm]);

  return suggestions;
}
