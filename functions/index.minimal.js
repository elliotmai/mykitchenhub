/**
 * MyKitchenHub - Minimal Test Functions
 * Use this to verify your setup works before using the full index.js
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp();

// Simple test function
exports.helloWorld = functions.https.onRequest((req, res) => {
  res.json({
    message: "Hello from MyKitchenHub!",
    status: "Functions are working!",
    timestamp: new Date().toISOString()
  });
});

// Test function that uses Firestore
exports.testFirestore = functions.https.onRequest(async (req, res) => {
  try {
    const db = admin.firestore();
    
    // Try to write and read
    const testRef = db.collection('test').doc('test-doc');
    await testRef.set({
      message: "Test successful!",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const doc = await testRef.get();
    const data = doc.data();
    
    res.json({
      status: "success",
      message: "Firestore is working!",
      data: data
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// Minimal sync function (no external dependencies)
exports.syncLegacyRecipes = functions.https.onRequest(async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      error: 'Missing userId'
    });
  }
  
  res.json({
    status: 'success',
    message: 'Minimal sync function working!',
    userId: userId,
    note: 'Replace with full implementation from index.js.full when ready'
  });
});
