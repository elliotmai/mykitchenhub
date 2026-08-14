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
// FUNCTION 3: Import HelloFresh Recipe from Photo (OCR)
// ============================================================================

/**
 * HTTP function to extract recipe from HelloFresh card photo
 * Uses OCR/AI to parse recipe card image
 * 
 * Expected request body:
 * {
 *   userId: "user-firebase-uid",
 *   imageUrl: "https://storage.googleapis.com/.../hellofresh-card.jpg"
 * }
 */
exports.importHelloFreshFromPhoto = functions.https.onRequest(async (req, res) => {
  try {
    console.log('Starting HelloFresh photo import...');
    
    // TODO: Implement in Phase 5
    // 1. Authenticate request
    // 2. Download image from storage
    // 3. Send to OCR/Vision API (Google Cloud Vision or Claude)
    // 4. Parse recipe data (title, ingredients, instructions)
    // 5. Create recipe in Firestore
    // 6. Return recipe ID
    
    const { userId, imageUrl } = req.body;
    
    if (!userId || !imageUrl) {
      return res.status(400).json({
        error: 'Missing required fields: userId, imageUrl'
      });
    }

    // Placeholder response
    res.status(200).json({
      status: 'success',
      message: 'HelloFresh photo import function ready (stub)',
      recipeId: null,
      recipeName: null,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in importHelloFreshFromPhoto:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================================================
// FUNCTION 4: Send Daily Waste Alerts (SMS)
// ============================================================================

/**
 * Scheduled function to send daily alerts for expiring items (9:00 AM daily).
 * Implementation lives in src/wasteAlerts/ — see roadmap 6.2.
 */
exports.sendDailyWasteAlerts = require('./src/wasteAlerts/sendDailyWasteAlerts').sendDailyWasteAlerts;

// ============================================================================
// FUNCTION 5: Generate AI Meal Plan
// ============================================================================

/**
 * HTTP function to generate weekly meal plan using Claude AI
 * 
 * Expected request body:
 * {
 *   userId: "user-firebase-uid",
 *   preferences: {
 *     dietaryRestrictions: ["vegetarian", "gluten-free"],
 *     dislikes: ["mushrooms"],
 *     servings: 2,
 *     mealsPerWeek: 5
 *   }
 * }
 */
exports.generateMealPlan = functions
  .runWith({
    timeoutSeconds: 120,  // AI calls may take longer
    memory: '512MB'
  })
  .https.onRequest(async (req, res) => {
    try {
      console.log('Starting AI meal plan generation...');
      
      // TODO: Implement in Phase 7
      // 1. Authenticate request
      // 2. Get user's:
      //    - Expiring inventory items
      //    - Available recipes
      //    - HelloFresh schedule
      //    - Dietary preferences
      // 3. Build AI prompt with context
      // 4. Call Anthropic Claude API
      // 5. Parse AI response into structured meal plan
      // 6. Save meal plan to Firestore
      // 7. Return meal plan
      
      const { userId, preferences } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          error: 'Missing required field: userId'
        });
      }

      // Placeholder response
      res.status(200).json({
        status: 'success',
        message: 'AI meal plan generation function ready (stub)',
        mealPlan: {
          weekOf: new Date().toISOString(),
          meals: [],
          shoppingList: []
        },
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error in generateMealPlan:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

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
 * Helper: Send SMS via the configured provider (Textbelt/Zixlow).
 *
 * Implemented in src/wasteAlerts/smsClient.js. With no provider key configured
 * it logs and reports a skip rather than failing — callers fall back to an
 * in-app notification.
 */
async function sendSMS(phoneNumber, message) {
  return require('./src/wasteAlerts/smsClient').sendSms(phoneNumber, message);
}

/**
 * Helper: Call Claude AI API
 */
async function callClaudeAI(prompt) {
  // TODO: Implement in Phase 7
  // const response = await axios.post('https://api.anthropic.com/v1/messages', {
  //   model: 'claude-3-5-sonnet-20241022',
  //   max_tokens: 1024,
  //   messages: [{ role: 'user', content: prompt }]
  // }, {
  //   headers: {
  //     'x-api-key': process.env.ANTHROPIC_API_KEY,
  //     'anthropic-version': '2023-06-01'
  //   }
  // });
  // return response.data.content[0].text;
  
  console.log('Claude AI stub called with prompt:', prompt);
  return 'AI response placeholder';
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