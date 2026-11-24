// src/hooks/useAuth.js
// Sign-in for KitchenHub: the one Hive account (Supabase Auth, shared by every
// app on flyingdoublemranch.com; see src/backend/auth.js).
// Provides auth state, user info, and auth methods throughout the app

import { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
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
} from '../backend/auth';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  limit,
  serverTimestamp,
} from '../backend/firestore';
import { auth, db } from '../services/firebase';
import { authErrorMessage, friendlyError } from '../utils/firebaseErrors';

/**
 * Auth Context
 * Provides authentication state and methods to the entire app
 */
const AuthContext = createContext(null);

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

  // Listen for auth state changes. Signed in to Hive anywhere on the shared
  // domain means signed in here too: the session is the same cookie.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (signedIn) => {
      if (signedIn) {
        setUser(signedIn);
        try {
          const userDoc = await getDoc(doc(db, 'users', signedIn.uid));
          if (userDoc.exists()) {
            setUserProfile(userDoc.data());
          } else if (signedIn.email) {
            // Someone from Hive opening KitchenHub for the first time: give
            // them a profile (and the household its shelves, if it has none).
            await provisionProfileLocally(signedIn.uid, signedIn.email, signedIn.displayName);
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
    // provisionProfileLocally is stable (useCallback with no dependencies).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Build a new cook's profile (and, for a household that has none, its
   * shelves) from the browser.
   *
   * Only ever called for a cook who has no profile yet: it would reset an
   * existing profile's createdAt and preferences.
   */
  // useCallback so this stays referentially stable. createUserProfile calls it
  // and `signup` calls that, and signup is itself a useCallback with no
  // dependencies — an unstable helper in that chain is what react-hooks flags.
  // One setup per cook, however many callers ask at once: signing up both
  // fires the auth listener and calls createUserProfile.
  const provisioning = useRef(new Map());
  const provisionProfileLocally = useCallback((userId, email, displayName) => {
    if (!provisioning.current.has(userId)) {
      provisioning.current.set(
        userId,
        buildKitchen(userId, email, displayName).finally(() => provisioning.current.delete(userId))
      );
    }
    return provisioning.current.get(userId);
    // buildKitchen only uses state setters, which React keeps stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildKitchen = async (userId, email, displayName) => {
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

    // The shelves belong to the household: only a household with none yet
    // gets the defaults. `label`, not `name` — the list and the location
    // dropdown both render it. Kept in step with
    // functions/src/data/defaultLocations.js.
    const existing = await getDocs(
      query(collection(db, 'users', userId, 'storageLocations'), limit(1))
    );
    if (existing.empty) {
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
    }

    return fallbackData;
  };

  /**
   * Set up a new cook: their profile, and the household's default shelves if
   * it has none. Reads first, so an account that already has a profile (a
   * person from Hive, or an old KitchenHub account brought over) keeps it.
   */
  const createUserProfile = useCallback(
    async (userId, email, displayName = null) => {
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setUserProfile(userData);
          return userData;
        }
      } catch (err) {
        console.error('Could not read the profile before setting it up:', err);
        return null;
      }
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

        // The profile, and the household's shelves if it has none yet
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
