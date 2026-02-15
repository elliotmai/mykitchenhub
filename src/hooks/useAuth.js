// src/hooks/useAuth.js
// Custom hook for Firebase Authentication
// Provides auth state, user info, and auth methods throughout the app

import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  updateEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../services/firebase';

/**
 * Auth Context
 * Provides authentication state and methods to the entire app
 */
const AuthContext = createContext(null);
const functionsUrl = process.env.REACT_APP_FIREBASE_FUNCTIONS_URL;

/**
 * useAuth Hook
 * 
 * Access authentication state and methods from any component.
 * Must be used within an AuthProvider.
 * 
 * Usage:
 * const { user, loading, login, signup, logout } = useAuth();
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * AuthProvider Component
 * 
 * Wraps the app and provides authentication context to all children.
 * Handles auth state persistence and user session management.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        // Fetch additional user profile from Firestore
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setUserProfile(userDoc.data());
          }
        } catch (err) {
          console.error('Error fetching user profile:', err);
        }
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  /**
   * Create user profile in Firestore using Cloud Function
   * This calls the onUserCreated function which sets up:
   * - User document with preferences
   * - Default storage locations (Fridge, Freezer, Pantry, Counter)
   * - Sync metadata for recipes
   */
  const createUserProfile = async (userId, email, displayName = null) => {
    try {
      // Call the Cloud Function to set up the user
      
      
      if (!functionsUrl) {
        throw new Error('REACT_APP_FIREBASE_FUNCTIONS_URL not configured');
      }

      const response = await fetch(
        `${functionsUrl}/onUserCreated`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId,
            email,
            displayName: displayName || email.split('@')[0],
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create user profile');
      }

      const result = await response.json();
      console.log('User setup complete:', result);

      // Fetch the created user profile
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setUserProfile(userData);
        return userData;
      }

      throw new Error('User profile not found after creation');
    } catch (error) {
      console.error('Error creating user profile via Cloud Function:', error);
      
      // Fallback: Create basic user document if Cloud Function fails
      console.log('Falling back to local user creation...');
      const userRef = doc(db, 'users', userId);
      const fallbackData = {
        email,
        displayName: displayName || email.split('@')[0],
        createdAt: serverTimestamp(),
        preferences: {
          smsAlerts: {
            enabled: false,
            phoneNumber: '',
            time: '09:00'
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
          },
          helloFresh: {
            linked: false,
            deliveryDays: [1, 3, 5]
          }
        },
        stats: {
          totalRecipes: 0,
          totalItems: 0,
          wasteReduction: 0
        }
      };

      await setDoc(userRef, fallbackData);
      setUserProfile(fallbackData);
      
      // Create basic storage locations as fallback
      const defaultLocations = [
        { name: 'Main Fridge', type: 'fridge', icon: '🧊', color: '#3498db', order: 1 },
        { name: 'Freezer', type: 'freezer', icon: '❄️', color: '#9b59b6', order: 2 },
        { name: 'Pantry', type: 'pantry', icon: '🏺', color: '#e67e22', order: 3 },
        { name: 'Counter', type: 'pantry', icon: '🍞', color: '#f39c12', order: 4 },
      ];

      for (const location of defaultLocations) {
        const locationRef = doc(db, 'users', userId, 'storageLocations', `${location.type}_${location.order}`);
        await setDoc(locationRef, {
          ...location,
          isDefault: true,
          itemCount: 0,
          createdAt: serverTimestamp(),
        });
      }
      
      console.log('Created fallback storage locations');
      
      return fallbackData;
    }
  };

  /**
   * Sign up with email and password
   */
  const signup = useCallback(async (email, password, displayName = null) => {
    setError(null);
    try {
      const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password);
      
      // Update display name if provided
      if (displayName) {
        await updateProfile(newUser, { displayName });
      }

      // Create user profile in Firestore (via Cloud Function)
      // This will automatically create storage locations and set up the user
      await createUserProfile(newUser.uid, email, displayName);

      return { success: true, user: newUser };
    } catch (err) {
      setError(err.message);
      return { success: false, error: getAuthErrorMessage(err.code) };
    }
  }, []);

  /**
   * Log in with email and password
   */
  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const { user: loggedInUser } = await signInWithEmailAndPassword(auth, email, password);
      return { success: true, user: loggedInUser };
    } catch (err) {
      setError(err.message);
      return { success: false, error: getAuthErrorMessage(err.code) };
    }
  }, []);

  /**
   * Log out the current user
   */
  const logout = useCallback(async () => {
    setError(null);
    try {
      await signOut(auth);
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, []);

  /**
   * Send password reset email
   */
  const resetPassword = useCallback(async (email) => {
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: getAuthErrorMessage(err.code) };
    }
  }, []);

  /**
   * Update user profile
   */
  const updateUserProfile = useCallback(async (updates) => {
    if (!user) return { success: false, error: 'No user logged in' };

    try {
      // Update Firebase Auth profile if display name is included
      if (updates.displayName) {
        await updateProfile(user, { displayName: updates.displayName });
      }

      // Update Firestore profile
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, updates, { merge: true });
      
      setUserProfile(prev => ({ ...prev, ...updates }));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [user]);

  /**
   * Update user email
   */
  const updateUserEmail = useCallback(async (newEmail, currentPassword) => {
    if (!user) return { success: false, error: 'No user logged in' };

    try {
      // Re-authenticate first
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      
      // Update email
      await updateEmail(user, newEmail);
      
      // Update Firestore
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { email: newEmail }, { merge: true });
      
      return { success: true };
    } catch (err) {
      return { success: false, error: getAuthErrorMessage(err.code) };
    }
  }, [user]);

  /**
   * Update user password
   */
  const updateUserPassword = useCallback(async (currentPassword, newPassword) => {
    if (!user) return { success: false, error: 'No user logged in' };

    try {
      // Re-authenticate first
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      
      // Update password
      await updatePassword(user, newPassword);
      
      return { success: true };
    } catch (err) {
      return { success: false, error: getAuthErrorMessage(err.code) };
    }
  }, [user]);

  const value = {
    // State
    user,
    userProfile,
    loading,
    error,
    isAuthenticated: !!user,
    
    // Methods
    login,
    signup,
    logout,
    resetPassword,
    updateUserProfile,
    updateUserEmail,
    updateUserPassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Get user-friendly error messages for Firebase Auth errors
 */
const getAuthErrorMessage = (errorCode) => {
  const errorMessages = {
    'auth/email-already-in-use': 'This email is already registered. Please log in or use a different email.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/operation-not-allowed': 'Email/password accounts are not enabled. Please contact support.',
    'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
    'auth/user-disabled': 'This account has been disabled. Please contact support.',
    'auth/user-not-found': 'No account found with this email. Please sign up first.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Please check your connection.',
    'auth/invalid-credential': 'Invalid email or password. Please try again.',
    'auth/requires-recent-login': 'Please log out and log back in to perform this action.',
  };

  return errorMessages[errorCode] || 'An unexpected error occurred. Please try again.';
};

export default useAuth;
