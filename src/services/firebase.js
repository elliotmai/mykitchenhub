// src/services/firebase.js
// Firebase Configuration for MyKitchenHub
// This file initializes Firebase and exports auth, database, storage, and functions

import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

// Validate that all required config values are present
const requiredConfigKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

const missingKeys = requiredConfigKeys.filter(key => !firebaseConfig[key]);
if (missingKeys.length > 0) {
  console.error(
    `Missing Firebase config values: ${missingKeys.join(', ')}. ` +
    'Make sure your .env file is set up correctly.'
  );
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Connect to emulators in development (optional - for local testing)
if (process.env.NODE_ENV === 'development' && process.env.REACT_APP_USE_EMULATORS === 'true') {
  console.log('🔧 Connecting to Firebase emulators...');
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectStorageEmulator(storage, 'localhost', 9199);
  connectFunctionsEmulator(functions, 'localhost', 5001);
}

// Export the app instance for advanced use cases
export default app;

// Helper function to check if Firebase is properly initialized
export const isFirebaseInitialized = () => {
  return app && auth && db && storage && functions;
};

// Log initialization status in development
if (process.env.NODE_ENV === 'development') {
  console.log('🔥 Firebase initialized:', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    initialized: isFirebaseInitialized(),
  });
}
