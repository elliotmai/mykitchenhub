// initializeSchema.js
// Firestore Schema Initialization Script
// Creates all collections, subcollections, and initial documents

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// Make sure you have your service account key
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/**
 * Initialize default storage locations for a user
 */
async function initializeStorageLocations(userId) {
  console.log(`Creating default storage locations for user: ${userId}`);

  const defaultLocations = [
    {
      label: 'Main Fridge',
      type: 'fridge',
      icon: '🧊',
      color: '#A8D5E2',
      order: 0,
      isDefault: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    },
    {
      label: 'Main Freezer',
      type: 'freezer',
      icon: '❄️',
      color: '#D4C5E2',
      order: 1,
      isDefault: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    },
    {
      label: 'Pantry',
      type: 'pantry',
      icon: '🏠',
      color: '#F5C6AA',
      order: 2,
      isDefault: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }
  ];

  const batch = db.batch();

  for (const location of defaultLocations) {
    const locationRef = db.collection('users').doc(userId)
      .collection('storageLocations').doc();
    batch.set(locationRef, location);
  }

  await batch.commit();
  console.log('✓ Default storage locations created');
}

/**
 * Create a sample user document
 */
async function createSampleUser() {
  console.log('Creating sample user...');

  const userId = 'sample-user-id';
  const userRef = db.collection('users').doc(userId);

  const userData = {
    email: 'test@mykitchenhub.com',
    displayName: 'Test User',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    preferences: {
      dietaryRestrictions: ['vegetarian'],
      dislikedIngredients: ['cilantro', 'mushrooms'],
      defaultServings: 1,
      phoneNumber: '+1234567890'
    },
    helloFresh: {
      enabled: false,
      deliveryDay: 'monday',
      mealsPerWeek: 3,
      lastDeliveryDate: null,
      nextDeliveryDate: null
    }
  };

  await userRef.set(userData);
  console.log('✓ Sample user created');

  // Create storage locations for this user
  await initializeStorageLocations(userId);

  return userId;
}

/**
 * Create sample inventory items
 */
async function createSampleInventory(userId) {
  console.log('Creating sample inventory items...');

  // First, get a storage location ID
  const locationsSnapshot = await db.collection('users').doc(userId)
    .collection('storageLocations')
    .where('type', '==', 'freezer')
    .limit(1)
    .get();

  const locationId = locationsSnapshot.docs[0]?.id;

  const now = new Date();

  const sampleItems = [
    {
      name: 'chicken breast',
      normalized: 'chicken breast',
      quantity: 2,
      unit: 'lbs',
      locationId: locationId,
      locationType: 'freezer',
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 270 * 24 * 60 * 60 * 1000), // 270 days
      shelfLifeDays: 270,
      notes: 'organic, from Costco',
      source: 'manual',
      purchaseHistory: [{
        addedAt: now,  // Use Date object, not serverTimestamp() in arrays
        quantity: 2,
        unit: 'lbs',
        price: 12.99,
        store: 'Costco'
      }],
      totalTimesPurchased: 1
    },
    {
      name: 'milk',
      normalized: 'milk',
      quantity: 1,
      unit: 'gallon',
      locationId: locationId,
      locationType: 'fridge',
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      shelfLifeDays: 7,
      notes: 'whole milk',
      source: 'manual',
      purchaseHistory: [{
        addedAt: now,  // Use Date object, not serverTimestamp() in arrays
        quantity: 1,
        unit: 'gallon',
        price: 4.99,
        store: 'Safeway'
      }],
      totalTimesPurchased: 1
    }
  ];

  const batch = db.batch();

  for (const item of sampleItems) {
    const itemRef = db.collection('users').doc(userId)
      .collection('inventory').doc();
    batch.set(itemRef, item);
  }

  await batch.commit();
  console.log('✓ Sample inventory items created');
}

/**
 * Create sample recipes
 */
async function createSampleRecipes() {
  console.log('Creating sample recipes...');

  const sampleRecipes = [
    {
      name: 'Chicken Stir Fry',
      ingredients: [
        {
          name: 'chicken breast',
          quantity: 1,
          unit: 'lb',
          normalized: 'chicken breast'
        },
        {
          name: 'soy sauce',
          quantity: 2,
          unit: 'tbsp',
          normalized: 'soy sauce'
        },
        {
          name: 'vegetables',
          quantity: 2,
          unit: 'cups',
          normalized: 'mixed vegetables'
        }
      ],
      instructions: 'Cut chicken into bite-sized pieces. Heat oil in a wok or large pan. Cook chicken until golden. Add vegetables and stir-fry for 5 minutes. Add soy sauce and cook for 2 more minutes.',
      source: 'user-created',
      legacyId: null,
      sourceId: null,
      imageUrl: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      tags: ['dinner', 'protein', 'quick', 'asian'],
      prepTime: 15,
      cookTime: 20,
      servings: 4,
      difficulty: 'easy',
      timesCooked: 0
    },
    {
      name: 'Simple Pasta',
      ingredients: [
        {
          name: 'pasta',
          quantity: 1,
          unit: 'lb',
          normalized: 'pasta'
        },
        {
          name: 'tomato sauce',
          quantity: 2,
          unit: 'cups',
          normalized: 'tomato sauce'
        },
        {
          name: 'parmesan',
          quantity: 0.5,
          unit: 'cup',
          normalized: 'parmesan cheese'
        }
      ],
      instructions: 'Boil water and cook pasta according to package directions. Heat tomato sauce in a separate pan. Drain pasta and mix with sauce. Top with parmesan cheese.',
      source: 'user-created',
      legacyId: null,
      sourceId: null,
      imageUrl: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      tags: ['dinner', 'pasta', 'quick', 'italian'],
      prepTime: 5,
      cookTime: 15,
      servings: 4,
      difficulty: 'easy',
      timesCooked: 0
    }
  ];

  const batch = db.batch();

  for (const recipe of sampleRecipes) {
    const recipeRef = db.collection('recipes').doc();
    batch.set(recipeRef, recipe);
  }

  await batch.commit();
  console.log('✓ Sample recipes created');
}

/**
 * Create syncMetadata document
 */
async function createSyncMetadata() {
  console.log('Creating syncMetadata document...');

  const syncMetadataRef = db.collection('syncMetadata').doc('legacy-recipe-sync');

  const syncData = {
    legacyProjectId: 'lets-eat-firebase-project',
    enabled: false,
    lastSyncTimestamp: null,
    recipesToProcess: 0,
    recipesProcessed: 0,
    instructionSources: {
      spoonacular: 0,
      ai_generated: 0
    },
    costAccumulated: 0,
    currentStatus: 'idle'
  };

  await syncMetadataRef.set(syncData);
  console.log('✓ syncMetadata document created');
}

/**
 * Main initialization function
 */
async function initializeSchema() {
  try {
    console.log('=== Starting Firestore Schema Initialization ===\n');

    // Create sample user and subcollections
    const userId = await createSampleUser();
    await createSampleInventory(userId);

    // Create top-level collections
    await createSampleRecipes();
    await createSyncMetadata();

    console.log('\n=== Schema Initialization Complete ===');
    console.log('\nCollections created:');
    console.log('  ✓ users');
    console.log('  ✓ users/{userId}/storageLocations');
    console.log('  ✓ users/{userId}/inventory');
    console.log('  ✓ recipes');
    console.log('  ✓ syncMetadata');
    console.log('\nNext steps:');
    console.log('  1. Deploy security rules: firebase deploy --only firestore:rules');
    console.log('  2. Run CRUD tests: node testCRUD.js');

  } catch (error) {
    console.error('Error initializing schema:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run initialization
initializeSchema();