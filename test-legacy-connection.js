/**
 * Test Script: Verify Connection to "Let's Eat" Firebase Project
 * 
 * This script tests your service account configuration and Firestore access.
 * Run this BEFORE implementing the full syncLegacyRecipes function.
 * 
 * Usage:
 *   cd functions
 *   npm install dotenv
 *   node test-legacy-connection.js
 */

const admin = require('firebase-admin');
require('dotenv').config();

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testLegacyConnection() {
  console.log('\n' + '='.repeat(60));
  log('Testing Connection to "Let\'s Eat" Firebase Project', 'cyan');
  console.log('='.repeat(60) + '\n');

  try {
    // Step 1: Load service account
    log('Step 1: Loading service account credentials...', 'blue');
    
    const serviceAccountPath = process.env.LEGACY_FIREBASE_SERVICE_ACCOUNT_PATH;
    
    if (!serviceAccountPath) {
      throw new Error(
        'LEGACY_FIREBASE_SERVICE_ACCOUNT_PATH not found in .env file.\n' +
        'Please add: LEGACY_FIREBASE_SERVICE_ACCOUNT_PATH=./legacy-firebase-service-account.json'
      );
    }

    log(`  Path: ${serviceAccountPath}`, 'reset');
    
    let serviceAccount;
    try {
      serviceAccount = require(serviceAccountPath);
      log('  ✓ Service account file loaded successfully', 'green');
      log(`  Project ID: ${serviceAccount.project_id}`, 'reset');
    } catch (error) {
      throw new Error(
        `Could not load service account file: ${serviceAccountPath}\n` +
        'Make sure you:\n' +
        '  1. Downloaded the service account JSON from "Let\'s Eat" Firebase Console\n' +
        '  2. Renamed it to: legacy-firebase-service-account.json\n' +
        '  3. Placed it in the functions/ directory\n\n' +
        'See LEGACY-FIREBASE-SETUP.md for detailed instructions.'
      );
    }

    // Step 2: Initialize Firebase Admin
    log('\nStep 2: Initializing Firebase Admin SDK...', 'blue');
    
    const legacyApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    }, 'legacy-test');
    
    log('  ✓ Firebase Admin initialized', 'green');

    const legacyDb = legacyApp.firestore();
    log('  ✓ Firestore instance created', 'green');

    // Step 3: Test Firestore access
    log('\nStep 3: Testing Firestore access...', 'blue');
    
    // List all collections
    const collections = await legacyDb.listCollections();
    log('  ✓ Successfully connected to Firestore!', 'green');
    
    console.log('\n' + '-'.repeat(60));
    log('Collections found in "Let\'s Eat" project:', 'cyan');
    console.log('-'.repeat(60));
    
    if (collections.length === 0) {
      log('  No collections found (database might be empty)', 'yellow');
    } else {
      for (const collection of collections) {
        console.log(`  📁 ${collection.id}`);
      }
    }

    // Step 4: Check for recipes collection
    log('\nStep 4: Checking recipes collection...', 'blue');
    
    try {
      const recipesSnapshot = await legacyDb.collection('recipes').limit(5).get();
      
      if (recipesSnapshot.empty) {
        log('  ⚠ Recipes collection exists but is empty', 'yellow');
      } else {
        log(`  ✓ Found ${recipesSnapshot.size} recipes (showing first 5)`, 'green');
        
        console.log('\n' + '-'.repeat(60));
        log('Sample recipes:', 'cyan');
        console.log('-'.repeat(60));
        
        recipesSnapshot.forEach((doc, index) => {
          const recipe = doc.data();
          console.log(`\n  ${index + 1}. ${recipe.title || recipe.name || 'Untitled'}`);
          console.log(`     ID: ${doc.id}`);
          if (recipe.ingredients) {
            console.log(`     Ingredients: ${recipe.ingredients.length || 'N/A'}`);
          }
          if (recipe.createdAt) {
            console.log(`     Created: ${recipe.createdAt.toDate ? recipe.createdAt.toDate().toDateString() : recipe.createdAt}`);
          }
        });
      }
    } catch (error) {
      log('  ⚠ Could not access recipes collection', 'yellow');
      log(`    Error: ${error.message}`, 'red');
    }

    // Step 5: Check for users collection
    log('\n\nStep 5: Checking users collection...', 'blue');
    
    try {
      const usersSnapshot = await legacyDb.collection('users').limit(1).get();
      
      if (usersSnapshot.empty) {
        log('  ⚠ Users collection exists but is empty', 'yellow');
      } else {
        log(`  ✓ Users collection accessible`, 'green');
        log(`    Found ${usersSnapshot.size} user(s)`, 'reset');
      }
    } catch (error) {
      log('  ⚠ Could not access users collection', 'yellow');
      log(`    Error: ${error.message}`, 'red');
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    log('✅ CONNECTION TEST SUCCESSFUL!', 'green');
    console.log('='.repeat(60));
    
    console.log('\nYou can now:');
    console.log('  1. ✓ Access "Let\'s Eat" Firestore from your Cloud Functions');
    console.log('  2. ✓ Implement syncLegacyRecipes function (Phase 4)');
    console.log('  3. ✓ Read and transform recipe data');
    
    console.log('\nNext steps:');
    console.log('  - Document your "Let\'s Eat" recipe schema');
    console.log('  - Plan data transformation logic');
    console.log('  - Implement full sync in Phase 4');
    
    console.log('\n');
    process.exit(0);

  } catch (error) {
    console.log('\n' + '='.repeat(60));
    log('❌ CONNECTION TEST FAILED', 'red');
    console.log('='.repeat(60));
    
    console.log('\nError details:');
    log(error.message, 'red');
    
    console.log('\nTroubleshooting:');
    console.log('  1. Check that LEGACY_FIREBASE_SERVICE_ACCOUNT_PATH is set in .env');
    console.log('  2. Verify legacy-firebase-service-account.json exists in functions/');
    console.log('  3. Confirm you downloaded it from the correct Firebase project');
    console.log('  4. See LEGACY-FIREBASE-SETUP.md for detailed instructions');
    
    console.log('\n');
    process.exit(1);
  }
}

// Run the test
testLegacyConnection();
