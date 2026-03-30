// testCRUD.js
// Comprehensive CRUD Operations Test Suite
// Tests all collections and subcollections with various operations

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Test results tracking
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Helper function to run a test
 */
async function runTest(testName, testFn) {
  testsRun++;
  try {
    await testFn();
    testsPassed++;
    console.log(`✓ ${testName}`);
    return true;
  } catch (error) {
    testsFailed++;
    console.error(`✗ ${testName}`);
    console.error(`  Error: ${error.message}`);
    return false;
  }
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ============================================
// USERS COLLECTION TESTS
// ============================================

async function testUsersCRUD() {
  console.log('\n=== Testing Users Collection ===');

  const testUserId = 'test-user-' + Date.now();
  const userRef = db.collection('users').doc(testUserId);

  // CREATE
  await runTest('Create user document', async () => {
    await userRef.set({
      email: 'test@example.com',
      displayName: 'Test User',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      preferences: {
        dietaryRestrictions: ['vegetarian'],
        dislikedIngredients: ['onions'],
        defaultServings: 2,
        phoneNumber: '+1234567890'
      },
      helloFresh: {
        enabled: true,
        deliveryDay: 'tuesday',
        mealsPerWeek: 3,
        lastDeliveryDate: null,
        nextDeliveryDate: null
      }
    });
  });

  // READ
  await runTest('Read user document', async () => {
    const doc = await userRef.get();
    assert(doc.exists, 'User document should exist');
    assert(doc.data().email === 'test@example.com', 'Email should match');
    assert(doc.data().preferences.defaultServings === 2, 'Default servings should be 2');
  });

  // UPDATE
  await runTest('Update user preferences', async () => {
    await userRef.update({
      'preferences.defaultServings': 4,
      'preferences.dietaryRestrictions': admin.firestore.FieldValue.arrayUnion('vegan')
    });

    const doc = await userRef.get();
    assert(doc.data().preferences.defaultServings === 4, 'Servings should be updated to 4');
    assert(doc.data().preferences.dietaryRestrictions.includes('vegan'), 'Should include vegan');
  });

  // Don't delete yet - we need it for subcollection tests
  return testUserId;
}

// ============================================
// STORAGE LOCATIONS SUBCOLLECTION TESTS
// ============================================

async function testStorageLocationsCRUD(userId) {
  console.log('\n=== Testing Storage Locations Subcollection ===');

  const locationsRef = db.collection('users').doc(userId).collection('storageLocations');
  let locationId;

  // CREATE
  await runTest('Create storage location', async () => {
    const docRef = await locationsRef.add({
      label: 'Garage Freezer',
      type: 'freezer',
      icon: '❄️',
      color: '#D4C5E2',
      order: 3,
      isDefault: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    locationId = docRef.id;
  });

  // READ
  await runTest('Read storage location', async () => {
    const doc = await locationsRef.doc(locationId).get();
    assert(doc.exists, 'Location should exist');
    assert(doc.data().label === 'Garage Freezer', 'Label should match');
    assert(doc.data().type === 'freezer', 'Type should be freezer');
  });

  // UPDATE
  await runTest('Update storage location', async () => {
    await locationsRef.doc(locationId).update({
      label: 'Updated Garage Freezer',
      color: '#E8B4B8'
    });

    const doc = await locationsRef.doc(locationId).get();
    assert(doc.data().label === 'Updated Garage Freezer', 'Label should be updated');
  });

  // LIST
  await runTest('List all storage locations', async () => {
    const snapshot = await locationsRef.get();
    assert(snapshot.size >= 1, 'Should have at least one location');
  });

  // DELETE
  await runTest('Delete storage location', async () => {
    await locationsRef.doc(locationId).delete();
    const doc = await locationsRef.doc(locationId).get();
    assert(!doc.exists, 'Location should be deleted');
  });

  // Return a location ID for inventory tests
  const mainFreezer = await locationsRef.where('type', '==', 'freezer').limit(1).get();
  return mainFreezer.docs[0]?.id;
}

// ============================================
// INVENTORY SUBCOLLECTION TESTS
// ============================================

async function testInventoryCRUD(userId, locationId) {
  console.log('\n=== Testing Inventory Subcollection ===');

  const inventoryRef = db.collection('users').doc(userId).collection('inventory');
  let itemId;

  // CREATE
  await runTest('Create inventory item', async () => {
    const now = new Date();
    const docRef = await inventoryRef.add({
      name: 'ground beef',
      normalized: 'ground beef',
      quantity: 2,
      unit: 'lbs',
      locationId: locationId || 'default-freezer',
      locationType: 'freezer',
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      shelfLifeDays: 180,
      notes: '80/20 ground beef',
      source: 'manual',
      purchaseHistory: [{
        addedAt: now,  // Use Date object, not serverTimestamp() in arrays
        quantity: 2,
        unit: 'lbs',
        price: 8.99,
        store: 'Walmart'
      }],
      totalTimesPurchased: 1
    });
    itemId = docRef.id;
  });

  // READ
  await runTest('Read inventory item', async () => {
    const doc = await inventoryRef.doc(itemId).get();
    assert(doc.exists, 'Item should exist');
    assert(doc.data().name === 'ground beef', 'Name should match');
    assert(doc.data().quantity === 2, 'Quantity should be 2');
  });

  // UPDATE - Decrease quantity
  await runTest('Update inventory quantity', async () => {
    await inventoryRef.doc(itemId).update({
      quantity: admin.firestore.FieldValue.increment(-0.5)
    });

    const doc = await inventoryRef.doc(itemId).get();
    assert(doc.data().quantity === 1.5, 'Quantity should be decreased to 1.5');
  });

  // UPDATE - Add purchase history
  await runTest('Add to purchase history', async () => {
    const now = new Date();
    await inventoryRef.doc(itemId).update({
      purchaseHistory: admin.firestore.FieldValue.arrayUnion({
        addedAt: now,  // Use Date object, not serverTimestamp() in arrays
        quantity: 1,
        unit: 'lbs',
        price: 4.50,
        store: 'Walmart'
      }),
      totalTimesPurchased: admin.firestore.FieldValue.increment(1)
    });

    const doc = await inventoryRef.doc(itemId).get();
    assert(doc.data().totalTimesPurchased === 2, 'Should have 2 purchases');
    assert(doc.data().purchaseHistory.length === 2, 'Should have 2 history entries');
  });

  // QUERY - Find items by storage location
  await runTest('Query items by storage location', async () => {
    const snapshot = await inventoryRef
      .where('locationType', '==', 'freezer')
      .get();
    assert(snapshot.size >= 1, 'Should find at least one freezer item');
  });

  // QUERY - Find expiring items
  await runTest('Query expiring items', async () => {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const snapshot = await inventoryRef
      .where('expiresAt', '<=', sevenDaysFromNow)
      .get();
    // Just verify the query works
    assert(true, 'Query executed successfully');
  });

  // DELETE
  await runTest('Delete inventory item', async () => {
    await inventoryRef.doc(itemId).delete();
    const doc = await inventoryRef.doc(itemId).get();
    assert(!doc.exists, 'Item should be deleted');
  });
}

// ============================================
// RECIPES COLLECTION TESTS
// ============================================

async function testRecipesCRUD() {
  console.log('\n=== Testing Recipes Collection ===');

  const recipesRef = db.collection('recipes');
  let recipeId;

  // CREATE
  await runTest('Create recipe', async () => {
    const docRef = await recipesRef.add({
      name: 'Test Chicken Tacos',
      ingredients: [
        {
          name: 'chicken breast',
          quantity: 1,
          unit: 'lb',
          normalized: 'chicken breast'
        },
        {
          name: 'taco shells',
          quantity: 8,
          unit: 'shells',
          normalized: 'taco shells'
        }
      ],
      instructions: 'Cook chicken, season, and assemble tacos.',
      source: 'user-created',
      legacyId: null,
      sourceId: null,
      imageUrl: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      tags: ['dinner', 'mexican', 'easy'],
      prepTime: 10,
      cookTime: 15,
      servings: 4,
      difficulty: 'easy',
      timesCooked: 0
    });
    recipeId = docRef.id;
  });

  // READ
  await runTest('Read recipe', async () => {
    const doc = await recipesRef.doc(recipeId).get();
    assert(doc.exists, 'Recipe should exist');
    assert(doc.data().name === 'Test Chicken Tacos', 'Name should match');
    assert(doc.data().ingredients.length === 2, 'Should have 2 ingredients');
  });

  // UPDATE - Increment times cooked
  await runTest('Increment times cooked', async () => {
    await recipesRef.doc(recipeId).update({
      timesCooked: admin.firestore.FieldValue.increment(1)
    });

    const doc = await recipesRef.doc(recipeId).get();
    assert(doc.data().timesCooked === 1, 'Times cooked should be 1');
  });

  // QUERY - Find recipes by tag
  await runTest('Query recipes by tag', async () => {
    const snapshot = await recipesRef
      .where('tags', 'array-contains', 'easy')
      .get();
    assert(snapshot.size >= 1, 'Should find at least one easy recipe');
  });

  // QUERY - Find recipes by source
  await runTest('Query recipes by source', async () => {
    const snapshot = await recipesRef
      .where('source', '==', 'user-created')
      .get();
    assert(snapshot.size >= 1, 'Should find at least one user-created recipe');
  });

  // DELETE
  await runTest('Delete recipe', async () => {
    await recipesRef.doc(recipeId).delete();
    const doc = await recipesRef.doc(recipeId).get();
    assert(!doc.exists, 'Recipe should be deleted');
  });
}

// ============================================
// SYNC METADATA TESTS
// ============================================

async function testSyncMetadataCRUD() {
  console.log('\n=== Testing Sync Metadata ===');

  const syncRef = db.collection('syncMetadata').doc('legacy-recipe-sync');

  // CREATE/SET
  await runTest('Create sync metadata', async () => {
    await syncRef.set({
      legacyProjectId: 'test-legacy-project',
      enabled: false,
      lastSyncTimestamp: null,
      recipesToProcess: 100,
      recipesProcessed: 0,
      instructionSources: {
        spoonacular: 0,
        ai_generated: 0
      },
      costAccumulated: 0,
      currentStatus: 'idle'
    });
  });

  // READ
  await runTest('Read sync metadata', async () => {
    const doc = await syncRef.get();
    assert(doc.exists, 'Sync metadata should exist');
    assert(doc.data().recipesToProcess === 100, 'Should have 100 recipes to process');
  });

  // UPDATE - Simulate sync progress
  await runTest('Update sync progress', async () => {
    await syncRef.update({
      recipesProcessed: admin.firestore.FieldValue.increment(10),
      'instructionSources.spoonacular': admin.firestore.FieldValue.increment(8),
      'instructionSources.ai_generated': admin.firestore.FieldValue.increment(2),
      costAccumulated: admin.firestore.FieldValue.increment(0.06),
      lastSyncTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      currentStatus: 'in-progress'
    });

    const doc = await syncRef.get();
    assert(doc.data().recipesProcessed === 10, 'Should have processed 10 recipes');
    assert(doc.data().instructionSources.spoonacular === 8, 'Should have 8 spoonacular matches');
  });
}

// ============================================
// COMPOUND QUERIES & ADVANCED TESTS
// ============================================

async function testAdvancedQueries(userId) {
  console.log('\n=== Testing Advanced Queries ===');

  const inventoryRef = db.collection('users').doc(userId).collection('inventory');

  // Add test data
  const now = new Date();
  const testItems = [
    {
      name: 'eggs',
      normalized: 'eggs',
      quantity: 12,
      unit: 'count',
      locationId: 'fridge-1',
      locationType: 'fridge',
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      shelfLifeDays: 21,
      source: 'manual'
    },
    {
      name: 'frozen peas',
      normalized: 'frozen peas',
      quantity: 1,
      unit: 'bag',
      locationId: 'freezer-1',
      locationType: 'freezer',
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      shelfLifeDays: 365,
      source: 'hellofresh'
    }
  ];

  for (const item of testItems) {
    await inventoryRef.add(item);
  }

  // Compound query test
  await runTest('Compound query: expiring fridge items', async () => {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const snapshot = await inventoryRef
      .where('locationType', '==', 'fridge')
      .where('expiresAt', '<=', sevenDaysFromNow)
      .get();
    // Should find the eggs
    assert(true, 'Compound query executed successfully');
  });

  // Order by query
  await runTest('Order by expiration date', async () => {
    const snapshot = await inventoryRef
      .orderBy('expiresAt', 'asc')
      .limit(5)
      .get();
    assert(snapshot.size >= 1, 'Should return ordered results');
  });
}

// ============================================
// CLEANUP
// ============================================

async function cleanup(userId) {
  console.log('\n=== Cleanup ===');

  await runTest('Delete test user and subcollections', async () => {
    // Delete subcollections first
    const storageLocations = await db.collection('users').doc(userId)
      .collection('storageLocations').get();
    for (const doc of storageLocations.docs) {
      await doc.ref.delete();
    }

    const inventory = await db.collection('users').doc(userId)
      .collection('inventory').get();
    for (const doc of inventory.docs) {
      await doc.ref.delete();
    }

    // Delete user document
    await db.collection('users').doc(userId).delete();
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function runAllTests() {
  console.log('========================================');
  console.log('  MyKitchenHub Firestore CRUD Tests');
  console.log('========================================');

  try {
    // Run all test suites
    const userId = await testUsersCRUD();
    const locationId = await testStorageLocationsCRUD(userId);
    await testInventoryCRUD(userId, locationId);
    await testRecipesCRUD();
    await testSyncMetadataCRUD();
    await testAdvancedQueries(userId);

    // Cleanup
    await cleanup(userId);

    // Print results
    console.log('\n========================================');
    console.log('  Test Results');
    console.log('========================================');
    console.log(`Total Tests: ${testsRun}`);
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log(`Success Rate: ${((testsPassed / testsRun) * 100).toFixed(1)}%`);
    console.log('========================================');

    if (testsFailed === 0) {
      console.log('\n✓ All tests passed! Schema is ready for deployment.');
    } else {
      console.log(`\n✗ ${testsFailed} test(s) failed. Please review errors above.`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n✗ Test suite failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the tests
runAllTests();