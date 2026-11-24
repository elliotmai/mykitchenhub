// src/services/firebase.js
// The handles the screens import: auth, db, storage and functions.
//
// KitchenHub moved from Firebase to Hive's Supabase project (schema
// `kitchen`, bucket `kitchen`, one sign-in for every app on
// flyingdoublemranch.com). The modules in ../backend answer the same calls
// the Firebase SDK did, so the hooks read as before.

import { getAuth } from '../backend/auth';
import { getFirestore } from '../backend/firestore';
import { getStorage } from '../backend/storage';
import { getFunctions } from '../backend/functions';

export const auth = getAuth();
export const db = getFirestore();
export const storage = getStorage();
export const functions = getFunctions();

const app = { name: 'kitchenhub' };
export default app;

export const isFirebaseInitialized = () => Boolean(auth && db && storage && functions);
