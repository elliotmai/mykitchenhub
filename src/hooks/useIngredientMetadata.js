// React hook for ingredient metadata and expiration calculations
// Use this in your frontend to access shelf life data

import { useMemo } from 'react';

// Ingredient shelf life data (same as backend)
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
  
  // Meat - Raw
  'chicken breast': { fridge: 2, freezer: 270, pantry: null },
  'ground beef': { fridge: 2, freezer: 120, pantry: null },
  'steak': { fridge: 3, freezer: 180, pantry: null },
  'pork chops': { fridge: 3, freezer: 180, pantry: null },
  'ground turkey': { fridge: 2, freezer: 120, pantry: null },
  'bacon': { fridge: 7, freezer: 30, pantry: null },
  'sausage': { fridge: 2, freezer: 60, pantry: null },
  
  // Seafood
  'salmon': { fridge: 2, freezer: 90, pantry: null },
  'shrimp': { fridge: 2, freezer: 180, pantry: null },
  
  // Vegetables
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
  
  // Fruits
  'apples': { fridge: 30, freezer: 365, pantry: 7 },
  'bananas': { fridge: 7, freezer: 90, pantry: 5 },
  'oranges': { fridge: 21, freezer: 120, pantry: 7 },
  'strawberries': { fridge: 7, freezer: 365, pantry: null },
  'blueberries': { fridge: 14, freezer: 365, pantry: null },
  
  // Bread & Grains
  'bread': { fridge: 7, freezer: 90, pantry: 5 },
  'rice': { fridge: null, freezer: null, pantry: 730 },
  'pasta': { fridge: null, freezer: null, pantry: 730 },
  
  // Add more as needed...
};

/**
 * Custom hook for ingredient metadata
 */
export function useIngredientMetadata() {
  
  const getShelfLife = (ingredientName, locationType) => {
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
  
  const getAllIngredients = () => {
    return Object.keys(ingredientShelfLife).sort();
  };
  
  const searchIngredients = (searchTerm) => {
    const term = searchTerm.toLowerCase().trim();
    return getAllIngredients().filter(ingredient => 
      ingredient.includes(term)
    );
  };
  
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
      expired: '#dc3545',  // red
      today: '#fd7e14',    // orange
      urgent: '#ffc107',   // yellow
      soon: '#28a745',     // green
      fresh: '#28a745',    // green
      unknown: '#6c757d'   // gray
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
    ingredientShelfLife
  };
}

/**
 * Hook for autocomplete suggestions
 */
export function useIngredientAutocomplete(searchTerm) {
  const { searchIngredients } = useIngredientMetadata();
  
  const suggestions = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return [];
    return searchIngredients(searchTerm).slice(0, 10); // Limit to 10 suggestions
  }, [searchTerm]);
  
  return suggestions;
}
