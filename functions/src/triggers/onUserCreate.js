// Cloud Function trigger for new user creation
// Automatically sets up default storage locations and user preferences

const { getFirestore } = require('firebase-admin/firestore');
const { getDefaultLocations } = require('../data/defaultLocations');

/**
 * Cloud Function triggered when a new user is created in Firebase Auth
 * Creates user document with default storage locations and preferences
 */
async function onUserCreate(user) {
  const db = getFirestore();
  const userId = user.uid;
  const email = user.email;
  
  console.log(`Setting up new user: ${userId} (${email})`);
  
  try {
    // Create user document
    const userRef = db.collection('users').doc(userId);
    
    const userData = {
      email: email,
      displayName: user.displayName || email.split('@')[0],
      createdAt: new Date().toISOString(),
      preferences: {
        smsAlerts: {
          enabled: false,
          phoneNumber: '',
          time: '09:00' // 9 AM default
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
        }
      },
      // Top-level, not under `preferences`. This is the shape
      // SCHEMA_DOCUMENTATION.md documents, the shape firestore.rules requires
      // on create, and — the part that actually mattered — the only shape
      // anything reads: `readHelloFresh` in functions/src/mealPlan/planContext.js
      // looks at `profile.helloFresh`, so while these settings were seeded
      // under `preferences` the meal planner never saw the delivery days at
      // all. src/hooks/useDeliveries.js has always written here.
      helloFresh: {
        enabled: false,
        deliveryDays: [1, 3, 5], // Monday, Wednesday, Friday
        mealsPerWeek: 0
      },
      stats: {
        totalRecipes: 0,
        totalItems: 0,
        wasteReduction: 0
      }
    };
    
    await userRef.set(userData);
    console.log(`User document created for ${userId}`);
    
    // Create default storage locations
    const defaultLocations = getDefaultLocations(true); // Only get default locations
    const storageLocationsRef = userRef.collection('storageLocations');
    
    const batch = db.batch();
    
    for (const location of defaultLocations) {
      const locationRef = storageLocationsRef.doc();
      batch.set(locationRef, {
        ...location,
        createdAt: new Date().toISOString(),
        itemCount: 0
      });
    }
    
    await batch.commit();
    console.log(`Created ${defaultLocations.length} default storage locations for ${userId}`);
    
    // Create initial syncMetadata document (for legacy recipe sync)
    const syncMetadataRef = userRef.collection('syncMetadata').doc('recipesSync');
    await syncMetadataRef.set({
      lastSyncAt: null,
      totalRecipesSynced: 0,
      syncStatus: 'pending',
      syncErrors: []
    });
    
    console.log(`User setup complete for ${userId}`);
    
    return {
      success: true,
      userId: userId,
      locationsCreated: defaultLocations.length
    };
    
  } catch (error) {
    console.error(`Error setting up user ${userId}:`, error);
    throw error;
  }
}

/**
 * Add additional storage locations to an existing user
 * @param {string} userId - User ID
 * @param {Array} locations - Array of location objects to add
 */
async function addStorageLocations(userId, locations) {
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);
  const storageLocationsRef = userRef.collection('storageLocations');
  
  const batch = db.batch();
  
  for (const location of locations) {
    const locationRef = storageLocationsRef.doc();
    batch.set(locationRef, {
      ...location,
      createdAt: new Date().toISOString(),
      itemCount: 0
    });
  }
  
  await batch.commit();
  console.log(`Added ${locations.length} storage locations for user ${userId}`);
  
  return locations.length;
}

/**
 * Reset user's storage locations to defaults
 * WARNING: This will delete all existing locations and their inventory
 * @param {string} userId - User ID
 */
async function resetToDefaultLocations(userId) {
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);
  const storageLocationsRef = userRef.collection('storageLocations');
  
  console.warn(`Resetting storage locations for user ${userId} - this will delete all existing data`);
  
  // Delete all existing locations
  const existingLocations = await storageLocationsRef.get();
  const batch = db.batch();
  
  existingLocations.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  
  // Create default locations
  const defaultLocations = getDefaultLocations(true);
  await addStorageLocations(userId, defaultLocations);
  
  console.log(`Reset complete for user ${userId}`);
  return defaultLocations.length;
}

module.exports = {
  onUserCreate,
  addStorageLocations,
  resetToDefaultLocations
};
