// Firebase Cloud Functions index file
// Main entry point for all cloud functions (1st Gen)

// Load environment variables from .env file
require('dotenv').config();

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin
admin.initializeApp();

// Firestore reference
const db = admin.firestore();

// Import trigger functions
const { onUserCreate } = require('./src/triggers/onUserCreate');

// Import seed data utilities
const { 
  seedInventory, 
  seedRecipes, 
  seedAll, 
  clearAll 
} = require('./src/utils/seedData');

/**
 * Auth Trigger: Runs when a new user is created
 * Automatically sets up default storage locations and preferences
 */
exports.onUserCreated = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  try {
    const { userId, email, displayName } = req.body;
    
    if (!userId || !email) {
      res.status(400).json({ error: 'Missing userId or email' });
      return;
    }
    
    const result = await onUserCreate({ 
      uid: userId, 
      email: email,
      displayName: displayName || null
    });
    res.json(result);
  } catch (error) {
    console.error('Error in onUserCreated:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Callable Function: Seed test data for a user
 * Only use in development/testing environments
 */
exports.seedTestData = functions.https.onCall(async (data, context) => {
  // In production, add authentication check here
  // if (!context.auth) {
  //   throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  // }
  
  const userId = data.userId || context.auth?.uid;
  
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'User ID required');
  }
  
  try {
    const result = await seedAll(userId);
    return {
      success: true,
      message: `Seeded ${result.inventoryItems} inventory items and ${result.recipes} recipes`,
      data: result
    };
  } catch (error) {
    console.error('Error seeding data:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Callable Function: Clear test data for a user
 * Only use in development/testing environments
 */
exports.clearTestData = functions.https.onCall(async (data, context) => {
  const userId = data.userId || context.auth?.uid;
  
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'User ID required');
  }
  
  try {
    const result = await clearAll(userId);
    return {
      success: true,
      message: `Cleared ${result.inventoryCleared} inventory items and ${result.recipesCleared} recipes`,
      data: result
    };
  } catch (error) {
    console.error('Error clearing data:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * HTTP Function: Seed inventory only
 * For development/testing
 */
exports.seedInventoryHttp = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  try {
    const userId = req.body.userId || req.query.userId;
    const itemCount = parseInt(req.body.itemCount || req.query.itemCount || '20');
    
    if (!userId) {
      res.status(400).json({ error: 'userId parameter required' });
      return;
    }
    
    const count = await seedInventory(userId, itemCount);
    res.json({ 
      success: true, 
      message: `Seeded ${count} inventory items`,
      itemsCreated: count 
    });
  } catch (error) {
    console.error('Error in seedInventoryHttp:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * HTTP Function: Seed recipes only
 * For development/testing
 */
exports.seedRecipesHttp = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  try {
    const userId = req.body.userId || req.query.userId;
    
    if (!userId) {
      res.status(400).json({ error: 'userId parameter required' });
      return;
    }
    
    const count = await seedRecipes(userId);
    res.json({ 
      success: true, 
      message: `Seeded ${count} recipes`,
      recipesCreated: count 
    });
  } catch (error) {
    console.error('Error in seedRecipesHttp:', error);
    res.status(500).json({ error: error.message });
  }
});

// Placeholder functions for future phases
// These will be implemented in later roadmap phases
// ============================================================================
// FUNCTION 1: Sync Legacy Recipes from "Let's Eat" App
// ============================================================================

/**
 * HTTP function to import recipes from the legacy "Let's Eat" app
 * 
 * "Let's Eat" Schema:
 *   users/{userId}/recipes/{recipeId}
 *   Fields: name (string), ingredients (array), tags (array)
 * 
 * Expected request body:
 * {
 *   userId: "user-firebase-uid"  // The userId from "Let's Eat" (could be different from MyKitchenHub userId)
 * }
 */
exports.syncLegacyRecipes = functions.https.onRequest(async (req, res) => {
  try {
    console.log('Starting legacy recipe sync...');
    
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        error: 'Missing required field: userId'
      });
    }

    // Initialize legacy Firebase connection
    let legacyApp, legacyDb;
    try {
      // Load service account from environment (only load when function is called)
      const serviceAccountPath = process.env.LEGACY_FIREBASE_SERVICE_ACCOUNT_PATH;
      
      if (!serviceAccountPath) {
        throw new Error('LEGACY_FIREBASE_SERVICE_ACCOUNT_PATH not configured in .env');
      }

      // Dynamically require the service account file
      const serviceAccount = require(serviceAccountPath);
      
      // Initialize separate Firebase instance for legacy project
      legacyApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      }, `legacy-${Date.now()}`); // Unique name for each invocation
      
      legacyDb = legacyApp.firestore();
      console.log('Connected to "Let\'s Eat" Firestore');
      
    } catch (error) {
      console.error('Failed to initialize legacy Firebase:', error);
      return res.status(500).json({
        error: 'Failed to connect to legacy database',
        message: error.message,
        hint: 'Make sure LEGACY_FIREBASE_SERVICE_ACCOUNT_PATH is set in .env and the file exists'
      });
    }

    // Get current Firebase (MyKitchenHub)
    const db = admin.firestore();

    // Check if already synced
    const syncDoc = await db
      .collection('users')
      .doc(userId)
      .collection('syncMetadata')
      .doc('legacyRecipes')
      .get();

    if (syncDoc.exists && syncDoc.data().completed) {
      // Clean up legacy app instance
      await legacyApp.delete();
      
      return res.json({
        status: 'already_synced',
        message: 'Recipes already synced from Let\'s Eat',
        syncDate: syncDoc.data().completedAt.toDate().toISOString(),
        recipesCount: syncDoc.data().recipesCount || 0
      });
    }

    // Fetch recipes from Let's Eat
    // Schema: users/{userId}/recipes/{recipeId}
    console.log(`Fetching recipes for user: ${userId}`);
    
    const legacyRecipesSnapshot = await legacyDb
      .collection('users')
      .doc(userId)
      .collection('recipes')
      .get();

    if (legacyRecipesSnapshot.empty) {
      // Clean up legacy app instance
      await legacyApp.delete();
      
      return res.json({
        status: 'success',
        message: 'No recipes found in Let\'s Eat for this user',
        recipesImported: 0,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`Found ${legacyRecipesSnapshot.size} recipes in Let's Eat`);

    // Transform and import recipes
    const batch = db.batch();
    let importedCount = 0;
    let skippedCount = 0;

    for (const doc of legacyRecipesSnapshot.docs) {
      const legacyRecipe = doc.data();
      
      try {
        // Transform "Let's Eat" schema to MyKitchenHub schema
        const newRecipe = transformLegacyRecipe(legacyRecipe, doc.id);
        
        // Check if recipe already exists (by legacyId)
        const existingRecipe = await db
          .collection('recipes')
          .where('legacyId', '==', doc.id)
          .limit(1)
          .get();

        if (!existingRecipe.empty) {
          console.log(`Skipping duplicate recipe: ${newRecipe.name}`);
          skippedCount++;
          continue;
        }

        // Add to batch
        const recipeRef = db.collection('recipes').doc();
        batch.set(recipeRef, newRecipe);
        importedCount++;
        
      } catch (error) {
        console.error(`Error transforming recipe ${doc.id}:`, error);
        skippedCount++;
      }
    }

    // Mark as synced
    const syncRef = db
      .collection('users')
      .doc(userId)
      .collection('syncMetadata')
      .doc('legacyRecipes');
    
    batch.set(syncRef, {
      completed: true,
      completedAt: new Date().toISOString(),
      recipesCount: importedCount,
      skippedCount: skippedCount,
      totalFound: legacyRecipesSnapshot.size
    });

    // Commit all changes
    await batch.commit();
    console.log(`Successfully imported ${importedCount} recipes`);

    // Clean up legacy app instance
    await legacyApp.delete();

    res.json({
      status: 'success',
      message: 'Recipes synced successfully from Let\'s Eat',
      recipesImported: importedCount,
      recipesSkipped: skippedCount,
      totalFound: legacyRecipesSnapshot.size,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in syncLegacyRecipes:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Transform "Let's Eat" recipe to MyKitchenHub schema
 * 
 * Input schema (Let's Eat):
 * {
 *   name: string,
 *   ingredients: array,  // format may vary
 *   tags: array
 * }
 * 
 * Output schema (MyKitchenHub):
 * {
 *   name: string,
 *   ingredients: [{ name, quantity, unit, normalized }],
 *   instructions: string,
 *   source: "legacy",
 *   legacyId: string,
 *   tags: array,
 *   // ... other fields
 * }
 */
function transformLegacyRecipe(legacyRecipe, legacyId) {
  // Parse ingredients array
  // Ingredients might be strings like "1 cup milk" or objects like {name: "milk", amount: "1 cup"}
  const parsedIngredients = parseIngredients(legacyRecipe.ingredients || []);

  return {
    name: legacyRecipe.name || 'Untitled Recipe',
    
    ingredients: parsedIngredients,
    
    instructions: legacyRecipe.instructions || 'No instructions available from legacy recipe.',
    
    source: 'legacy',
    legacyId: legacyId,
    
    imageUrl: legacyRecipe.imageUrl || null,
    
    createdAt: new Date().toISOString(),
    
    tags: legacyRecipe.tags || [],
    
    prepTime: legacyRecipe.prepTime || null,
    cookTime: legacyRecipe.cookTime || null,
    servings: legacyRecipe.servings || 4,
    difficulty: legacyRecipe.difficulty || 'medium',
    
    timesCooked: 0
  };
}

/**
 * Parse ingredients from various formats to standardized format
 */
function parseIngredients(ingredients) {
  if (!Array.isArray(ingredients)) {
    return [];
  }

  return ingredients.map(ingredient => {
    // If ingredient is already an object with structured data
    if (typeof ingredient === 'object' && ingredient.name) {
      return {
        name: ingredient.name,
        quantity: parseFloat(ingredient.quantity || ingredient.amount) || 1,
        unit: ingredient.unit || extractUnit(ingredient.amount) || 'serving',
        normalized: ingredient.name.toLowerCase().trim()
      };
    }
    
    // If ingredient is a string like "1 cup milk"
    if (typeof ingredient === 'string') {
      const parsed = parseIngredientString(ingredient);
      return {
        name: parsed.name,
        quantity: parsed.quantity,
        unit: parsed.unit,
        normalized: parsed.name.toLowerCase().trim()
      };
    }
    
    // Fallback
    return {
      name: String(ingredient),
      quantity: 1,
      unit: 'serving',
      normalized: String(ingredient).toLowerCase().trim()
    };
  });
}

/**
 * Parse ingredient string like "1 cup milk" into components
 */
function parseIngredientString(ingredientStr) {
  const str = ingredientStr.trim();
  
  // Common units to look for
  const units = ['cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'teaspoon', 'teaspoons', 'tsp',
                 'pound', 'pounds', 'lb', 'lbs', 'ounce', 'ounces', 'oz', 'gram', 'grams', 'g',
                 'kilogram', 'kilograms', 'kg', 'liter', 'liters', 'l', 'milliliter', 'milliliters', 'ml',
                 'gallon', 'gallons', 'quart', 'quarts', 'pint', 'pints', 'piece', 'pieces', 'whole', 'clove', 'cloves'];
  
  // Try to extract quantity (number or fraction at the start)
  const quantityMatch = str.match(/^(\d+\/\d+|\d+\.?\d*)/);
  let quantity = 1;
  
  if (quantityMatch) {
    const matched = quantityMatch[1];
    // Handle fractions like "1/2"
    if (matched.includes('/')) {
      const parts = matched.split('/');
      quantity = parseFloat(parts[0]) / parseFloat(parts[1]);
    } else {
      quantity = parseFloat(matched);
    }
  }
  
  // Try to find unit
  let unit = 'serving';
  let nameStartIndex = 0;
  
  for (const u of units) {
    const regex = new RegExp(`\\b${u}\\b`, 'i');
    const match = str.match(regex);
    if (match) {
      unit = u.toLowerCase();
      nameStartIndex = match.index + match[0].length;
      break;
    }
  }
  
  // Extract name (everything after quantity and unit)
  let name = str.substring(nameStartIndex || (quantityMatch ? quantityMatch[0].length : 0)).trim();
  
  // Remove common articles
  name = name.replace(/^(of|a|an|the)\s+/i, '').trim();
  
  return {
    name: name || str,
    quantity: quantity,
    unit: unit
  };
}

/**
 * Extract unit from an amount string like "1 cup" or "2 tablespoons"
 */
function extractUnit(amountStr) {
  if (!amountStr) return 'serving';
  
  const units = ['cup', 'tablespoon', 'tbsp', 'teaspoon', 'tsp', 'pound', 'lb', 'ounce', 'oz',
                 'gram', 'g', 'kg', 'liter', 'l', 'ml', 'gallon', 'quart', 'pint', 'piece', 'whole'];
  
  const str = String(amountStr).toLowerCase();
  for (const unit of units) {
    if (str.includes(unit)) {
      return unit;
    }
  }
  
  return 'serving';
}

// ============================================================================
// FUNCTION 2: Import Inventory from CSV
// ============================================================================

/**
 * HTTP function to import inventory items from a CSV file
 *
 * Expected request body:
 * {
 *   userId: "user-firebase-uid",
 *   csvData: "name,quantity,unit,location\nMilk,1,gallon,Main Fridge\n...",
 *   fileName: "kitchen.csv"
 * }
 *
 * Implementation lives in src/csvImport/importInventoryFromCSV.js.
 */
exports.importInventoryFromCSV = require('./src/csvImport/importInventoryFromCSV').importInventoryFromCSV;

// ============================================================================
// FUNCTION 3: Import HelloFresh Recipes (Phase 5.1 photo, 5.2 URL)
// ============================================================================

// Both parse only — the browser writes the reviewed recipe under the signed-in
// user's own credentials. Implementation lives in src/hellofresh/.

const {
  importHelloFreshFromPhoto,
  importHelloFreshFromUrl,
} = require('./src/hellofresh/importHandlers');

exports.importHelloFreshFromPhoto = importHelloFreshFromPhoto;
exports.importHelloFreshFromUrl = importHelloFreshFromUrl;

// ============================================================================
// FUNCTION 4: Send Daily Waste Alerts (SMS)
// ============================================================================

/**
 * Scheduled function to send daily SMS alerts for expiring items
 * Runs every day at 9:00 AM
 * 
 * Uses Cloud Scheduler trigger
 */
exports.sendDailyWasteAlerts = functions.pubsub
  .schedule('0 9 * * *')  // 9:00 AM every day (cron format)
  .timeZone('America/New_York')  // TODO: Make timezone configurable per user
  .onRun(async (context) => {
    try {
      console.log('Starting daily waste alerts...');
      
      // TODO: Implement in Phase 6
      // 1. Query all users with SMS alerts enabled
      // 2. For each user:
      //    a. Get inventory items expiring in next 3 days
      //    b. Format alert message
      //    c. Send SMS via Textbelt/Twilio API
      // 3. Log results
      
      // Placeholder implementation
      const usersSnapshot = await db.collection('users').get();
      const totalUsers = usersSnapshot.size;
      
      console.log(`Daily waste alerts processed for ${totalUsers} users (stub)`);
      
      return null;
      
    } catch (error) {
      console.error('Error in sendDailyWasteAlerts:', error);
      throw error;
    }
  });

// ============================================================================
// FUNCTION 5: Generate AI Meal Plan
// ============================================================================

/**
 * Callable function that builds a week of meals with Claude, from the user's
 * expiring ingredients, preferences, HelloFresh schedule, and recipe library.
 *
 * Implementation lives in src/mealPlan/. It only generates — the client writes
 * the plan, so it passes through the same security rules as a hand-scheduled
 * meal. Degrades to a local planner when ANTHROPIC_API_KEY is absent.
 */
exports.generateMealPlan = require('./src/mealPlan/generateMealPlan').generateMealPlan;

// ==========================================================================
// FUNCTION 6: Storage Location Management (Create, Update, Delete with Safety Checks)
// ==========================================================================

// 1. Import the new storage location functions near the top of the file,
//    alongside the existing require statements:

const {
  createStorageLocation,
  updateStorageLocation,
  deleteStorageLocation,
} = require('./src/data/storageLocations');

// 2. Export them so Firebase deploys them as callable functions:

exports.createStorageLocation = createStorageLocation;
exports.updateStorageLocation = updateStorageLocation;
exports.deleteStorageLocation = deleteStorageLocation;

// ============================================================================
// HELPER FUNCTIONS (for future implementation)
// ============================================================================

/**
 * Helper: Send SMS via Textbelt API
 */
async function sendSMS(phoneNumber, message) {
  // TODO: Implement in Phase 6
  // const response = await axios.post('https://textbelt.com/text', {
  //   phone: phoneNumber,
  //   message: message,
  //   key: process.env.TEXTBELT_API_KEY
  // });
  // return response.data;
  
  console.log(`SMS stub: Would send to ${phoneNumber}: ${message}`);
  return { success: true };
}

/**
 * Helper: Call Claude AI API
 *
 * Implemented in src/mealPlan/anthropicClient.js — it reads ANTHROPIC_API_KEY
 * (falling back to Firebase Functions config), uses the official
 * @anthropic-ai/sdk, and returns null when no credential is configured so
 * callers can degrade instead of failing.
 */
async function callClaudeAI(prompt) {
  const { createClient, MODEL, MAX_TOKENS, textOf } = require('./src/mealPlan/anthropicClient');
  const client = createClient();
  if (!client) {
    console.warn('Claude API key not configured; skipping call.');
    return null;
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  return response?.stop_reason === 'refusal' ? null : textOf(response);
}

/**
 * Helper: Calculate expiration status
 */
function getExpirationStatus(expirationDate) {
  const now = new Date();
  const expDate = new Date(expirationDate);
  const daysUntilExpiration = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiration < 0) return 'expired';
  if (daysUntilExpiration <= 3) return 'urgent';
  if (daysUntilExpiration <= 7) return 'warning';
  return 'fresh';
}

// ============================================================================
// EXPORTS FOR TESTING
// ============================================================================

// Export helper functions for unit testing
if (process.env.NODE_ENV === 'test') {
  module.exports.helpers = {
    sendSMS,
    callClaudeAI,
    getExpirationStatus
  };
}