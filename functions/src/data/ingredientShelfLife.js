// Ingredient shelf life metadata
// Duration in days for each ingredient type by storage location

const ingredientShelfLife = {
  // Dairy Products
  'milk': { fridge: 7, freezer: 90, pantry: null },
  'butter': { fridge: 90, freezer: 365, pantry: null },
  'cheese': { fridge: 21, freezer: 180, pantry: null },
  'yogurt': { fridge: 14, freezer: 60, pantry: null },
  'cream': { fridge: 7, freezer: 120, pantry: null },
  'sour cream': { fridge: 14, freezer: 60, pantry: null },
  'cottage cheese': { fridge: 10, freezer: 90, pantry: null },
  'cream cheese': { fridge: 14, freezer: 60, pantry: null },

  // Eggs
  'eggs': { fridge: 35, freezer: 365, pantry: null },
  'egg whites': { fridge: 4, freezer: 365, pantry: null },
  'egg yolks': { fridge: 2, freezer: 365, pantry: null },

  // Meat - Raw
  'chicken breast': { fridge: 2, freezer: 270, pantry: null },
  'ground beef': { fridge: 2, freezer: 120, pantry: null },
  'steak': { fridge: 3, freezer: 180, pantry: null },
  'pork chops': { fridge: 3, freezer: 180, pantry: null },
  'ground turkey': { fridge: 2, freezer: 120, pantry: null },
  'bacon': { fridge: 7, freezer: 30, pantry: null },
  'sausage': { fridge: 2, freezer: 60, pantry: null },
  'lamb': { fridge: 3, freezer: 270, pantry: null },

  // Meat - Cooked
  'cooked chicken': { fridge: 4, freezer: 120, pantry: null },
  'cooked beef': { fridge: 4, freezer: 90, pantry: null },
  'cooked pork': { fridge: 4, freezer: 90, pantry: null },

  // Seafood
  'salmon': { fridge: 2, freezer: 90, pantry: null },
  'shrimp': { fridge: 2, freezer: 180, pantry: null },
  'tuna': { fridge: 2, freezer: 90, pantry: null },
  'cod': { fridge: 2, freezer: 180, pantry: null },
  'scallops': { fridge: 2, freezer: 90, pantry: null },
  'crab': { fridge: 2, freezer: 90, pantry: null },

  // Vegetables - Fresh
  'lettuce': { fridge: 7, freezer: null, pantry: null },
  'spinach': { fridge: 7, freezer: 365, pantry: null },
  'carrots': { fridge: 21, freezer: 365, pantry: null },
  'broccoli': { fridge: 7, freezer: 365, pantry: null },
  'bell peppers': { fridge: 7, freezer: 180, pantry: null },
  'tomatoes': { fridge: 7, freezer: 60, pantry: 3 },
  'onions': { fridge: 60, freezer: 180, pantry: 30 },
  'garlic': { fridge: 90, freezer: 365, pantry: 60 },
  'potatoes': { fridge: 21, freezer: 365, pantry: 60 },
  'celery': { fridge: 14, freezer: 365, pantry: null },
  'cucumbers': { fridge: 7, freezer: null, pantry: null },
  'mushrooms': { fridge: 7, freezer: 365, pantry: null },
  'zucchini': { fridge: 7, freezer: 90, pantry: null },
  'cauliflower': { fridge: 7, freezer: 365, pantry: null },
  'green beans': { fridge: 7, freezer: 365, pantry: null },
  'asparagus': { fridge: 4, freezer: 365, pantry: null },
  'kale': { fridge: 7, freezer: 365, pantry: null },
  'cabbage': { fridge: 21, freezer: 365, pantry: null },

  // Fruits
  'apples': { fridge: 30, freezer: 365, pantry: 7 },
  'bananas': { fridge: 7, freezer: 90, pantry: 5 },
  'oranges': { fridge: 21, freezer: 120, pantry: 7 },
  'strawberries': { fridge: 7, freezer: 365, pantry: null },
  'blueberries': { fridge: 14, freezer: 365, pantry: null },
  'grapes': { fridge: 7, freezer: 365, pantry: null },
  'lemons': { fridge: 21, freezer: 120, pantry: 7 },
  'limes': { fridge: 21, freezer: 120, pantry: 7 },
  'avocados': { fridge: 7, freezer: 180, pantry: 3 },
  'berries': { fridge: 7, freezer: 365, pantry: null },
  'peaches': { fridge: 7, freezer: 365, pantry: 3 },
  'pears': { fridge: 21, freezer: 365, pantry: 7 },

  // Bread & Grains
  'bread': { fridge: 7, freezer: 90, pantry: 5 },
  'tortillas': { fridge: 14, freezer: 180, pantry: 7 },
  'rice': { fridge: null, freezer: null, pantry: 730 },
  'pasta': { fridge: null, freezer: null, pantry: 730 },
  'flour': { fridge: null, freezer: 365, pantry: 180 },
  'oats': { fridge: null, freezer: null, pantry: 365 },
  'quinoa': { fridge: null, freezer: null, pantry: 730 },
  'couscous': { fridge: null, freezer: null, pantry: 365 },

  // Condiments & Sauces (unopened vs opened)
  'ketchup': { fridge: 180, freezer: null, pantry: 365 },
  'mustard': { fridge: 180, freezer: null, pantry: 365 },
  'mayonnaise': { fridge: 60, freezer: null, pantry: 120 },
  'soy sauce': { fridge: 730, freezer: null, pantry: 730 },
  'hot sauce': { fridge: 180, freezer: null, pantry: 365 },
  'salsa': { fridge: 30, freezer: null, pantry: 365 },
  'bbq sauce': { fridge: 120, freezer: null, pantry: 365 },
  'olive oil': { fridge: null, freezer: null, pantry: 365 },
  'vegetable oil': { fridge: null, freezer: null, pantry: 365 },

  // Canned & Jarred
  'canned tomatoes': { fridge: 5, freezer: null, pantry: 730 },
  'canned beans': { fridge: 4, freezer: null, pantry: 730 },
  'canned tuna': { fridge: 4, freezer: null, pantry: 1095 },
  'peanut butter': { fridge: 180, freezer: null, pantry: 365 },
  'jam': { fridge: 180, freezer: null, pantry: 365 },
  'pickles': { fridge: 90, freezer: null, pantry: 365 },

  // Nuts & Seeds
  'almonds': { fridge: 365, freezer: 730, pantry: 180 },
  'walnuts': { fridge: 180, freezer: 365, pantry: 90 },
  'peanuts': { fridge: 365, freezer: 730, pantry: 180 },
  'cashews': { fridge: 180, freezer: 365, pantry: 90 },
  'chia seeds': { fridge: 730, freezer: 730, pantry: 365 },
  'flax seeds': { fridge: 365, freezer: 730, pantry: 180 },

  // Beverages
  'orange juice': { fridge: 7, freezer: 365, pantry: null },
  'apple juice': { fridge: 7, freezer: 365, pantry: null },
  'wine': { fridge: 5, freezer: null, pantry: 1095 },
  'beer': { fridge: 180, freezer: null, pantry: 180 },

  // Herbs & Spices (fresh)
  'basil': { fridge: 7, freezer: 180, pantry: null },
  'cilantro': { fridge: 7, freezer: 180, pantry: null },
  'parsley': { fridge: 7, freezer: 180, pantry: null },
  'rosemary': { fridge: 14, freezer: 180, pantry: null },
  'thyme': { fridge: 14, freezer: 180, pantry: null },
  'mint': { fridge: 7, freezer: 180, pantry: null },
  'ginger': { fridge: 21, freezer: 180, pantry: null },

  // Dried Herbs & Spices
  'dried basil': { fridge: null, freezer: null, pantry: 730 },
  'black pepper': { fridge: null, freezer: null, pantry: 1095 },
  'cumin': { fridge: null, freezer: null, pantry: 1095 },
  'paprika': { fridge: null, freezer: null, pantry: 730 },
  'oregano': { fridge: null, freezer: null, pantry: 730 },
  'cinnamon': { fridge: null, freezer: null, pantry: 1095 },
  'chili powder': { fridge: null, freezer: null, pantry: 730 },

  // Baking
  'sugar': { fridge: null, freezer: null, pantry: 1825 },
  'brown sugar': { fridge: null, freezer: null, pantry: 365 },
  'baking powder': { fridge: null, freezer: null, pantry: 365 },
  'baking soda': { fridge: null, freezer: null, pantry: 730 },
  'vanilla extract': { fridge: null, freezer: null, pantry: 1825 },
  'honey': { fridge: null, freezer: null, pantry: 1825 },
  'maple syrup': { fridge: 365, freezer: null, pantry: 365 },

  // Frozen Foods
  'frozen vegetables': { fridge: null, freezer: 365, pantry: null },
  'frozen fruit': { fridge: null, freezer: 365, pantry: null },
  'ice cream': { fridge: null, freezer: 60, pantry: null },
  'frozen pizza': { fridge: null, freezer: 180, pantry: null },

  // Leftovers
  'cooked rice': { fridge: 4, freezer: 180, pantry: null },
  'cooked pasta': { fridge: 5, freezer: 60, pantry: null },
  'soup': { fridge: 4, freezer: 90, pantry: null },
  'stew': { fridge: 4, freezer: 90, pantry: null },
  'casserole': { fridge: 4, freezer: 90, pantry: null },
  'pizza': { fridge: 4, freezer: 60, pantry: null },
};

/**
 * Get shelf life for an ingredient in a specific location
 * @param {string} ingredientName - Name of the ingredient
 * @param {string} locationType - Type of storage location (fridge, freezer, pantry)
 * @returns {number|null} - Number of days until expiration, or null if not stored in that location
 */
function getShelfLife(ingredientName, locationType) {
  const normalizedName = ingredientName.toLowerCase().trim();
  const ingredient = ingredientShelfLife[normalizedName];
  
  if (!ingredient) {
    // Return default values if ingredient not found
    const defaults = {
      fridge: 7,
      freezer: 90,
      pantry: 30
    };
    return defaults[locationType] || 7;
  }
  
  return ingredient[locationType];
}

/**
 * Calculate expiration date for an ingredient
 * @param {string} ingredientName - Name of the ingredient
 * @param {string} locationType - Type of storage location
 * @param {Date} purchaseDate - Date the item was purchased/added
 * @returns {Date|null} - Expiration date, or null if item doesn't expire in that location
 */
function calculateExpirationDate(ingredientName, locationType, purchaseDate = new Date()) {
  const shelfLifeDays = getShelfLife(ingredientName, locationType);
  
  if (shelfLifeDays === null) {
    return null; // Item doesn't belong in this location
  }
  
  const expirationDate = new Date(purchaseDate);
  expirationDate.setDate(expirationDate.getDate() + shelfLifeDays);
  return expirationDate;
}

/**
 * Get all ingredients as an array (useful for autocomplete/search)
 * @returns {Array} - Array of ingredient names
 */
function getAllIngredients() {
  return Object.keys(ingredientShelfLife).sort();
}

/**
 * Search for ingredients by partial name
 * @param {string} searchTerm - Partial ingredient name
 * @returns {Array} - Array of matching ingredient names
 */
function searchIngredients(searchTerm) {
  const term = searchTerm.toLowerCase().trim();
  return getAllIngredients().filter(ingredient => 
    ingredient.includes(term)
  );
}

module.exports = {
  ingredientShelfLife,
  getShelfLife,
  calculateExpirationDate,
  getAllIngredients,
  searchIngredients
};
