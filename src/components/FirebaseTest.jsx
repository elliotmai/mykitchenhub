// src/components/FirebaseTest.jsx
// Test component to verify Firebase connection
// DELETE THIS FILE after confirming Firebase works!

import React, { useState, useEffect } from 'react';
import { auth, db, isFirebaseInitialized } from '../services/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { collection, addDoc, getDocs, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';

const FirebaseTest = () => {
  const [status, setStatus] = useState({
    firebase: 'checking...',
    auth: 'checking...',
    firestore: 'checking...',
  });
  const [user, setUser] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Check Firebase initialization on mount
  useEffect(() => {
    // Check basic initialization
    setStatus((prev) => ({
      ...prev,
      firebase: isFirebaseInitialized() ? '✅ Connected' : '❌ Not initialized',
    }));

    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setStatus((prev) => ({
        ...prev,
        auth: currentUser ? `✅ Signed in as ${currentUser.email}` : '✅ Ready (not signed in)',
      }));
    });

    // Test Firestore connection
    testFirestoreConnection();

    return () => unsubscribe();
  }, []);

  // Test Firestore read/write
  const testFirestoreConnection = async () => {
    try {
      // Try to read from Firestore
      const testCollection = collection(db, '_connectionTest');

      // Write a test document
      const docRef = await addDoc(testCollection, {
        test: true,
        timestamp: serverTimestamp(),
      });

      // Read it back
      const snapshot = await getDocs(testCollection);

      // Clean up - delete the test document
      await deleteDoc(doc(db, '_connectionTest', docRef.id));

      setStatus((prev) => ({
        ...prev,
        firestore: `✅ Connected (read/write working)`,
      }));
    } catch (error) {
      setStatus((prev) => ({
        ...prev,
        firestore: `❌ Error: ${error.message}`,
      }));
    }
  };

  // Test sign up
  const handleSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, testEmail, testPassword);
      setMessage(`✅ Account created for ${userCredential.user.email}`);
    } catch (error) {
      setMessage(`❌ Sign up error: ${error.message}`);
    }
    setLoading(false);
  };

  // Test sign in
  const handleSignIn = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const userCredential = await signInWithEmailAndPassword(auth, testEmail, testPassword);
      setMessage(`✅ Signed in as ${userCredential.user.email}`);
    } catch (error) {
      setMessage(`❌ Sign in error: ${error.message}`);
    }
    setLoading(false);
  };

  // Test sign out
  const handleSignOut = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      setMessage('✅ Signed out successfully');
    } catch (error) {
      setMessage(`❌ Sign out error: ${error.message}`);
    }
    setLoading(false);
  };

  const styles = {
    container: {
      maxWidth: '600px',
      margin: '40px auto',
      padding: '20px',
      fontFamily: 'Inter, -apple-system, sans-serif',
      backgroundColor: '#FAF8F3',
      borderRadius: '12px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    },
    header: {
      color: '#2C3E50',
      marginBottom: '20px',
      borderBottom: '2px solid #A8D5E2',
      paddingBottom: '10px',
    },
    statusCard: {
      backgroundColor: '#FFFFFF',
      padding: '15px',
      borderRadius: '8px',
      marginBottom: '20px',
      border: '1px solid #E0DED9',
    },
    statusItem: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid #E0DED9',
    },
    form: {
      backgroundColor: '#FFFFFF',
      padding: '20px',
      borderRadius: '8px',
      border: '1px solid #E0DED9',
    },
    input: {
      width: '100%',
      padding: '10px',
      marginBottom: '10px',
      border: '1px solid #E0DED9',
      borderRadius: '6px',
      fontSize: '14px',
    },
    button: {
      padding: '10px 20px',
      marginRight: '10px',
      marginTop: '10px',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
    },
    primaryButton: {
      backgroundColor: '#A8D5E2',
      color: '#2C3E50',
    },
    secondaryButton: {
      backgroundColor: '#B8D4B8',
      color: '#2C3E50',
    },
    dangerButton: {
      backgroundColor: '#E8B4B8',
      color: '#2C3E50',
    },
    message: {
      marginTop: '15px',
      padding: '10px',
      borderRadius: '6px',
      backgroundColor: '#D4C5E2',
    },
    warning: {
      backgroundColor: '#F5C6AA',
      padding: '15px',
      borderRadius: '8px',
      marginBottom: '20px',
      fontSize: '14px',
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>🔥 Firebase Connection Test</h1>

      <div style={styles.warning}>
        ⚠️ <strong>Delete this component</strong> after confirming Firebase works!
        <br />
        This is only for testing the initial setup.
      </div>

      {/* Connection Status */}
      <div style={styles.statusCard}>
        <h3>Connection Status</h3>
        <div style={styles.statusItem}>
          <span>Firebase SDK:</span>
          <span>{status.firebase}</span>
        </div>
        <div style={styles.statusItem}>
          <span>Authentication:</span>
          <span>{status.auth}</span>
        </div>
        <div style={{ ...styles.statusItem, borderBottom: 'none' }}>
          <span>Firestore Database:</span>
          <span>{status.firestore}</span>
        </div>
      </div>

      {/* Auth Test Form */}
      <div style={styles.form}>
        <h3>Test Authentication</h3>
        <p style={{ color: '#7F8C8D', fontSize: '14px' }}>
          Use a test email (can be fake, e.g., test@example.com)
        </p>

        <form onSubmit={handleSignIn}>
          <input
            type="email"
            placeholder="Email address"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            style={styles.input}
            required
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={testPassword}
            onChange={(e) => setTestPassword(e.target.value)}
            style={styles.input}
            minLength={6}
            required
          />

          <div>
            <button
              type="button"
              onClick={handleSignUp}
              disabled={loading}
              style={{ ...styles.button, ...styles.secondaryButton }}
            >
              {loading ? '...' : 'Sign Up'}
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{ ...styles.button, ...styles.primaryButton }}
            >
              {loading ? '...' : 'Sign In'}
            </button>
            {user && (
              <button
                type="button"
                onClick={handleSignOut}
                disabled={loading}
                style={{ ...styles.button, ...styles.dangerButton }}
              >
                Sign Out
              </button>
            )}
          </div>
        </form>

        {message && <div style={styles.message}>{message}</div>}
      </div>

      {/* Current User Info */}
      {user && (
        <div style={{ ...styles.statusCard, marginTop: '20px' }}>
          <h3>Current User</h3>
          <div style={styles.statusItem}>
            <span>Email:</span>
            <span>{user.email}</span>
          </div>
          <div style={styles.statusItem}>
            <span>UID:</span>
            <span style={{ fontSize: '12px' }}>{user.uid}</span>
          </div>
          <div style={{ ...styles.statusItem, borderBottom: 'none' }}>
            <span>Created:</span>
            <span>{new Date(user.metadata.creationTime).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default FirebaseTest;
