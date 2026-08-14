// Seed data scripts for testing
// Run these to populate your database with test data during development

const { getFirestore } = require('firebase-admin/firestore');
const { calculateExpirationDate, getAllIngredients } = require('../data/ingredientShelfLife');
const { getDefaultLocations } = require('../data/defaultLocations');

/**
 * Seed a user's inventory with sample items
 * @param {string} userId - User ID
 * @param {number} itemCount - Number of items to create (default: 20)
 */
async function seedInventory(userId, itemCount = 20) {
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);
  const inventoryRef = userRef.collection('inventory');
  
  console.log(`Seeding inventory for user ${userId} with ${itemCount} items...`);
  
  // Get user's storage locations
  const locationsSnapshot = await userRef.collection('storageLocations').get();
  const locations = [];
  locationsSnapshot.forEach(doc => {
    locations.push({ id: doc.id, ...doc.data() });
  });
  
  // If no locations exist, create default ones first
  if (locations.length === 0) {
    console.log('No storage locations found. Creating default locations...');
    const defaultLocations = getDefaultLocations(true);
    const batch = db.batch();
    
    const createdLocations = [];
    for (const location of defaultLocations) {
      const locationRef = userRef.collection('storageLocations').doc();
      batch.set(locationRef, {
        ...location,
        createdAt: new Date().toISOString(),
        itemCount: 0
      });
      createdLocations.push({ id: locationRef.id, ...location });
    }
    
    await batch.commit();
    console.log(`Created ${defaultLocations.length} default storage locations`);
    locations.push(...createdLocations);
  }
  
  // Sample inventory items to create
  const sampleItems = [
    { name: 'milk', quantity: 1, unit: 'gallon', locationType: 'fridge' },
    { name: 'eggs', quantity: 12, unit: 'count', locationType: 'fridge' },
    { name: 'chicken breast', quantity: 2, unit: 'lbs', locationType: 'fridge' },
    { name: 'ground beef', quantity: 1, unit: 'lb', locationType: 'freezer' },
    { name: 'bread', quantity: 1, unit: 'loaf', locationType: 'pantry' },
    { name: 'butter', quantity: 1, unit: 'stick', locationType: 'fridge' },
    { name: 'cheese', quantity: 8, unit: 'oz', locationType: 'fridge' },
    { name: 'lettuce', quantity: 1, unit: 'head', locationType: 'fridge' },
    { name: 'tomatoes', quantity: 4, unit: 'count', locationType: 'fridge' },
    { name: 'onions', quantity: 3, unit: 'count', locationType: 'pantry' },
    { name: 'garlic', quantity: 1, unit: 'bulb', locationType: 'pantry' },
    { name: 'potatoes', quantity: 5, unit: 'count', locationType: 'pantry' },
    { name: 'carrots', quantity: 1, unit: 'lb', locationType: 'fridge' },
    { name: 'broccoli', quantity: 1, unit: 'head', locationType: 'fridge' },
    { name: 'salmon', quantity: 2, unit: 'fillets', locationType: 'freezer' },
    { name: 'rice', quantity: 2, unit: 'lbs', locationType: 'pantry' },
    { name: 'pasta', quantity: 1, unit: 'box', locationType: 'pantry' },
    { name: 'olive oil', quantity: 1, unit: 'bottle', locationType: 'pantry' },
    { name: 'yogurt', quantity: 6, unit: 'cups', locationType: 'fridge' },
    { name: 'bananas', quantity: 6, unit: 'count', locationType: 'pantry' },
    { name: 'apples', quantity: 5, unit: 'count', locationType: 'fridge' },
    { name: 'frozen vegetables', quantity: 2, unit: 'bags', locationType: 'freezer' },
    { name: 'orange juice', quantity: 1, unit: 'carton', locationType: 'fridge' },
    { name: 'peanut butter', quantity: 1, unit: 'jar', locationType: 'pantry' },
    { name: 'jam', quantity: 1, unit: 'jar', locationType: 'fridge' },
  ];
  
  const batch = db.batch();
  const itemsToCreate = sampleItems.slice(0, itemCount);
  
  for (const item of itemsToCreate) {
    // Find matching storage location
    const location = locations.find(loc => loc.type === item.locationType);
    
    if (!location) {
      console.warn(`No location found for type ${item.locationType}, skipping ${item.name}`);
      continue;
    }
    
    // Ensure location has all required properties
    if (!location.id || !location.label || !location.type) {
      console.warn(`Invalid location data for ${item.name}, skipping`);
      continue;
    }
    
    // Calculate expiration date
    const purchaseDate = new Date();
    // Add some randomness to purchase dates (-5 to +2 days)
    const daysOffset = Math.floor(Math.random() * 8) - 5;
    purchaseDate.setDate(purchaseDate.getDate() + daysOffset);
    
    const expirationDate = calculateExpirationDate(item.name, item.locationType, purchaseDate);
    
    const inventoryItem = {
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      locationId: location.id,
      locationName: location.label || 'Unknown',
      locationType: location.type,
      purchaseDate: purchaseDate.toISOString(),
      expirationDate: expirationDate ? expirationDate.toISOString() : null,
      source: 'seed',
      notes: 'Test data',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const itemRef = inventoryRef.doc();
    batch.set(itemRef, inventoryItem);
  }
  
  await batch.commit();
  console.log(`Successfully seeded ${itemsToCreate.length} inventory items`);
  
  return itemsToCreate.length;
}

/**
 * Seed sample recipes for testing
 * @param {string} userId - User ID
 */
async function seedRecipes(userId) {
  const db = getFirestore();
  const recipesRef = db.collection('recipes');
  
  console.log(`Seeding sample recipes for user ${userId}...`);
  
  const sampleRecipes = [
    {
      title: 'Classic Spaghetti Carbonara',
      description: 'Traditional Italian pasta dish with eggs, cheese, and pancetta',
      servings: 4,
      prepTime: 10,
      cookTime: 20,
      difficulty: 'medium',
      ingredients: [
        { name: 'pasta', quantity: 1, unit: 'lb' },
        { name: 'eggs', quantity: 4, unit: 'count' },
        { name: 'cheese', quantity: 1, unit: 'cup' },
        { name: 'bacon', quantity: 6, unit: 'slices' },
        { name: 'garlic', quantity: 2, unit: 'cloves' },
        { name: 'black pepper', quantity: 1, unit: 'tsp' }
      ],
      instructions: [
        'Cook pasta according to package directions',
        'Fry bacon until crispy',
        'Beat eggs with cheese',
        'Combine everything while pasta is hot',
        'Season with black pepper and serve'
      ],
      tags: ['italian', 'pasta', 'dinner'],
      source: 'seed',
      userId: userId,
      isPublic: false,
      createdAt: new Date().toISOString()
    },
    {
      title: 'Chicken Stir Fry',
      description: 'Quick and healthy weeknight dinner',
      servings: 4,
      prepTime: 15,
      cookTime: 15,
      difficulty: 'easy',
      ingredients: [
        { name: 'chicken breast', quantity: 1.5, unit: 'lbs' },
        { name: 'broccoli', quantity: 2, unit: 'cups' },
        { name: 'carrots', quantity: 2, unit: 'count' },
        { name: 'bell peppers', quantity: 2, unit: 'count' },
        { name: 'soy sauce', quantity: 3, unit: 'tbsp' },
        { name: 'garlic', quantity: 3, unit: 'cloves' },
        { name: 'ginger', quantity: 1, unit: 'tbsp' },
        { name: 'rice', quantity: 2, unit: 'cups' }
      ],
      instructions: [
        'Cook rice according to package directions',
        'Cut chicken into bite-sized pieces',
        'Chop all vegetables',
        'Stir fry chicken until cooked through',
        'Add vegetables and sauce',
        'Serve over rice'
      ],
      tags: ['asian', 'chicken', 'healthy', 'quick'],
      source: 'seed',
      userId: userId,
      isPublic: false,
      createdAt: new Date().toISOString()
    },
    {
      title: 'Greek Salad',
      description: 'Fresh and light Mediterranean salad',
      servings: 4,
      prepTime: 15,
      cookTime: 0,
      difficulty: 'easy',
      ingredients: [
        { name: 'lettuce', quantity: 1, unit: 'head' },
        { name: 'tomatoes', quantity: 3, unit: 'count' },
        { name: 'cucumbers', quantity: 2, unit: 'count' },
        { name: 'onions', quantity: 1, unit: 'count' },
        { name: 'cheese', quantity: 1, unit: 'cup' },
        { name: 'olive oil', quantity: 3, unit: 'tbsp' },
        { name: 'lemons', quantity: 1, unit: 'count' }
      ],
      instructions: [
        'Chop all vegetables',
        'Combine in large bowl',
        'Add feta cheese',
        'Dress with olive oil and lemon juice',
        'Toss and serve immediately'
      ],
      tags: ['salad', 'healthy', 'vegetarian', 'mediterranean'],
      source: 'seed',
      userId: userId,
      isPublic: false,
      createdAt: new Date().toISOString()
    }
  ];
  
  const batch = db.batch();
  
  for (const recipe of sampleRecipes) {
    const recipeRef = recipesRef.doc();
    batch.set(recipeRef, recipe);
  }
  
  await batch.commit();
  console.log(`Successfully seeded ${sampleRecipes.length} recipes`);
  
  return sampleRecipes.length;
}

/**
 * Clear all inventory items for a user
 * @param {string} userId - User ID
 */
async function clearInventory(userId) {
  const db = getFirestore();
  const inventoryRef = db.collection('users').doc(userId).collection('inventory');
  
  console.log(`Clearing inventory for user ${userId}...`);
  
  const snapshot = await inventoryRef.get();
  const batch = db.batch();
  
  snapshot.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  console.log(`Cleared ${snapshot.size} inventory items`);
  
  return snapshot.size;
}

/**
 * Clear all recipes for a user
 * @param {string} userId - User ID
 */
async function clearRecipes(userId) {
  const db = getFirestore();
  const recipesRef = db.collection('recipes').where('userId', '==', userId);
  
  console.log(`Clearing recipes for user ${userId}...`);
  
  const snapshot = await recipesRef.get();
  const batch = db.batch();
  
  snapshot.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  console.log(`Cleared ${snapshot.size} recipes`);
  
  return snapshot.size;
}

/**
 * Full seed operation - sets up complete test environment
 * @param {string} userId - User ID
 */
async function seedAll(userId) {
  console.log(`Running full seed for user ${userId}...`);
  
  // Ensure user document exists
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();
  
  if (!userDoc.exists) {
    console.log('User document not found. Creating user document...');
    await userRef.set({
      createdAt: new Date().toISOString(),
      preferences: {
        smsAlerts: {
          enabled: false,
          phoneNumber: '',
          time: '09:00'
        },
        notifications: {
          expiringSoon: true,
          mealPlanReminders: true,
          lowInventory: false
        },
        dietary: {
          restrictions: [],
          preferences: [],
          allergies: []
        },
        helloFresh: {
          linked: false,
          deliveryDays: [1, 3, 5]
        }
      },
      stats: {
        totalRecipes: 0,
        totalItems: 0,
        wasteReduction: 0
      }
    });
    console.log('User document created');
  }
  
  const inventoryCount = await seedInventory(userId, 20);
  const recipeCount = await seedRecipes(userId);
  
  console.log(`Seed complete: ${inventoryCount} items, ${recipeCount} recipes`);
  
  return {
    inventoryItems: inventoryCount,
    recipes: recipeCount
  };
}

/**
 * Clear all test data for a user
 * @param {string} userId - User ID
 */
async function clearAll(userId) {
  console.log(`Clearing all test data for user ${userId}...`);
  
  const inventoryCleared = await clearInventory(userId);
  const recipesCleared = await clearRecipes(userId);
  
  console.log(`Clear complete: ${inventoryCleared} items, ${recipesCleared} recipes removed`);
  
  return {
    inventoryCleared,
    recipesCleared
  };
}

module.exports = {
  seedInventory,
  seedRecipes,
  clearInventory,
  clearRecipes,
  seedAll,
  clearAll
};
