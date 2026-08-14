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
// FUNCTION 1: Sync Legacy Recipes from "Let's Eat" App  (roadmap 4.2)
// ============================================================================
//
// Implementation lives in src/recipes/ — see that directory for the batching,
// cost ceiling and resume logic, and README.md for how to run it.

const { syncLegacyRecipes } = require('./src/recipes/syncLegacyRecipes');

exports.syncLegacyRecipes = syncLegacyRecipes;

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