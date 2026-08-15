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
import { authErrorMessage, friendlyError } from '../utils/firebaseErrors';
import { withRetry } from '../utils/retry';

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
   * Build the kitchen from the browser, because the Cloud Function could not.
   *
   * Only ever called for a cook who has no profile yet. Rewriting one that
   * already exists is refused outright by firestore.rules — `createdAt` and
   * `email` are pinned on update, and this payload carries a fresh
   * serverTimestamp() — so calling it on an existing profile turns a working
   * account into a failed signup. See the "signup fallback" cases in
   * firestore/tests/firestore.rules.test.js.
   */
  // useCallback so this stays referentially stable. createUserProfile calls it
  // and `signup` calls that, and signup is itself a useCallback with no
  // dependencies — an unstable helper in that chain is what react-hooks flags.
  const provisionProfileLocally = useCallback(async (userId, email, displayName) => {
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
          time: '09:00',
        },
        notifications: {
          expiringSoon: true,
          mealPlanReminders: true,
          lowInventory: false,
        },
        dietary: {
          restrictions: [],
          preferences: [],
          allergies: [],
        },
      },
      // Top level, not nested under preferences: firestore.rules lists
      // `helloFresh` among the fields a user document must have, and the
      // nested copy meant this fallback wrote a profile the rules reject.
      helloFresh: {
        linked: false,
        deliveryDays: [1, 3, 5],
      },
      stats: {
        totalRecipes: 0,
        totalItems: 0,
        wasteReduction: 0,
      },
    };

    await setDoc(userRef, fallbackData);
    setUserProfile(fallbackData);

    // Create basic storage locations as fallback
    // `label`, not `name`. firestore.rules requires `label`, and the list and
    // the location dropdown both render it — the `name` spelling gave a
    // fallback-provisioned kitchen four shelves with no titles on them.
    // Kept in step with functions/src/data/defaultLocations.js.
    const defaultLocations = [
      { label: 'Main Fridge', type: 'fridge', icon: '🧊', color: '#3498db', order: 1 },
      { label: 'Freezer', type: 'freezer', icon: '❄️', color: '#9b59b6', order: 2 },
      { label: 'Pantry', type: 'pantry', icon: '🏺', color: '#e67e22', order: 3 },
      { label: 'Counter', type: 'pantry', icon: '🍞', color: '#f39c12', order: 4 },
    ];

    for (const location of defaultLocations) {
      const locationRef = doc(
        db,
        'users',
        userId,
        'storageLocations',
        `${location.type}_${location.order}`
      );
      await setDoc(locationRef, {
        ...location,
        isDefault: true,
        itemCount: 0,
        createdAt: serverTimestamp(),
      });
    }

    console.log('Created fallback storage locations');

    return fallbackData;
  }, []);

  /**
   * Create user profile in Firestore using Cloud Function
   * This calls the onUserCreated function which sets up:
   * - User document with preferences
   * - Default storage locations (Fridge, Freezer, Pantry, Counter)
   * - Sync metadata for recipes
   */
  const createUserProfile = useCallback(
    async (userId, email, displayName = null) => {
      try {
        // Call the Cloud Function to set up the user

        if (!functionsUrl) {
          throw new Error('REACT_APP_FIREBASE_FUNCTIONS_URL not configured');
        }

        // Signing up is the one moment a cook cannot retry for themselves — a
        // failure here leaves an auth account with no kitchen behind it. The
        // function is idempotent (it setDocs a known user id), so retrying a
        // dropped connection is safe and worth doing before falling back.
        const response = await withRetry(
          () =>
            fetch(`${functionsUrl}/onUserCreated`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId,
                email,
                displayName: displayName || email.split('@')[0],
              }),
            }),
          { onRetry: ({ attempt }) => console.warn(`Retrying user setup (attempt ${attempt})`) }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to create user profile');
        }

        const result = await response.json();
        console.log('User setup complete:', result);
      } catch (error) {
        console.error('Error creating user profile via Cloud Function:', error);
        // Nothing provisioned the kitchen, so this is the only thing that will.
        return provisionProfileLocally(userId, email, displayName);
      }

      // -----------------------------------------------------------------------
      // Past this point the function has reported success, so the kitchen exists.
      //
      // Reading it back used to sit inside the try above, which meant a dropped
      // connection on *this* read — a read of a profile that definitely exists —
      // sent us into the fallback, and the fallback then rewrote a document that
      // was already there with a fresh serverTimestamp(). firestore.rules pins
      // `createdAt` on update, so that write is refused, signup reports a failure
      // for an account that was in fact provisioned perfectly, and trying again
      // just says the email is taken. A read failure is not a reason to write.
      // -----------------------------------------------------------------------
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));

        if (userDoc.exists()) {
          const userData = userDoc.data();
          setUserProfile(userData);
          return userData;
        }
      } catch (err) {
        // The profile is there; we just could not read it this second. The
        // onAuthStateChanged listener above fetches it again anyway.
        console.error('Created the profile but could not read it back:', err);
        return null;
      }

      // The function said it succeeded and yet there is nothing there. Rare, but
      // it leaves a cook with no kitchen unless we build one — and since nothing
      // exists to overwrite, the fallback is safe here.
      console.warn('User setup reported success but no profile was found; provisioning locally.');
      return provisionProfileLocally(userId, email, displayName);
    },
    [provisionProfileLocally]
  );

  /**
   * Sign up with email and password
   */
  const signup = useCallback(
    async (email, password, displayName = null) => {
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
        const message = authErrorMessage(err?.code);
        setError(message);
        return { success: false, error: message };
      }
    },
    [createUserProfile]
  );

  /**
   * Log in with email and password
   */
  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const { user: loggedInUser } = await signInWithEmailAndPassword(auth, email, password);
      return { success: true, user: loggedInUser };
    } catch (err) {
      const message = authErrorMessage(err?.code);
      setError(message);
      return { success: false, error: message };
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
      const message = friendlyError(err, { action: 'sign you out' });
      setError(message);
      return { success: false, error: message };
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
      const message = authErrorMessage(err?.code);
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  /**
   * Update user profile
   */
  const updateUserProfile = useCallback(
    async (updates) => {
      if (!user) return { success: false, error: 'No user logged in' };

      try {
        // Update Firebase Auth profile if display name is included
        if (updates.displayName) {
          await updateProfile(user, { displayName: updates.displayName });
        }

        // Update Firestore profile
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, updates, { merge: true });

        setUserProfile((prev) => ({ ...prev, ...updates }));
        return { success: true };
      } catch (err) {
        return { success: false, error: friendlyError(err, { action: 'save your profile' }) };
      }
    },
    [user]
  );

  /**
   * Update user email
   *
   * NOT WIRED INTO ANY SCREEN, and it cannot be as it stands: the Firestore
   * half of this will be denied under production rules. `firestore.rules` pins
   * the profile's `email` to its previous value on update, so the
   * `setDoc({ email: newEmail })` below fails while the Firebase Auth change
   * above has already succeeded — leaving the two out of step.
   *
   * Wiring this up means changing the rule as well, and the way to keep its
   * anti-spoofing intent is to pin the profile email to the *authenticated*
   * email rather than to the old one:
   *
   *   request.resource.data.email == request.auth.token.email
   *
   * Auth stays the source of truth, the profile is only allowed to follow it,
   * and a legitimate change goes through.
   */
  const updateUserEmail = useCallback(
    async (newEmail, currentPassword) => {
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
        return { success: false, error: authErrorMessage(err?.code) };
      }
    },
    [user]
  );

  /**
   * Update user password
   */
  const updateUserPassword = useCallback(
    async (currentPassword, newPassword) => {
      if (!user) return { success: false, error: 'No user logged in' };

      try {
        // Re-authenticate first
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);

        // Update password
        await updatePassword(user, newPassword);

        return { success: true };
      } catch (err) {
        return { success: false, error: authErrorMessage(err?.code) };
      }
    },
    [user]
  );

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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default useAuth;
