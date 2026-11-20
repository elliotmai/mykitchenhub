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

// The four development seed functions (seedTestData, clearTestData,
// seedInventoryHttp, seedRecipesHttp) are gone: each took the account to act
// on from the request itself, with no sign-in, so anyone could fill or wipe
// any account. The deploy runs with --force, which deletes them from Firebase.
// For test data, call src/utils/seedData.js from a local script with your own
// credentials.

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
 * Scheduled function to send daily alerts for expiring items (9:00 AM daily).
 * Implementation lives in src/wasteAlerts/ — see roadmap 6.2.
 */
exports.sendDailyWasteAlerts = require('./src/wasteAlerts/sendDailyWasteAlerts').sendDailyWasteAlerts;

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

// ==========================================================================
// FUNCTION 7: Fridge Board API (token-protected, server to server)
// ==========================================================================

// Bearer-token HTTP API for the Fridge Board kiosk. Implementation and routes
// live in src/board/; setup is in docs/BOARD_API.md.
exports.board = require('./src/board/board').board;

// Sign in with Hive: trade a Hive pass for a KitchenHub sign-in (src/hive/hiveExchange.js).
exports.hiveExchange = require('./src/hive/hiveExchange').hiveExchange;

// ==========================================================================
// FUNCTION 8: Connected apps (mint, list, revoke tokens for the board API)
// ==========================================================================

// Callables for Settings → Connected apps. Implementation lives in
// src/apiTokens/; tokens are stored as apiTokens/{sha256} (see auth.js).
const { listApiTokens, createApiToken, revokeApiToken } = require('./src/apiTokens/apiTokens');

exports.listApiTokens = listApiTokens;
exports.createApiToken = createApiToken;
exports.revokeApiToken = revokeApiToken;

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