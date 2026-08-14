// src/test-utils/mocks/auth.js
// Manual mock for the modular `firebase/auth` SDK.
//
// Auth state is test-driven: call `__setUser(user)` (inside `act()`) to move
// every registered onAuthStateChanged listener to a new state. Listeners are
// primed with the current user on registration, matching the real SDK.

/** Build a Firebase User-alike. */
export const __user = (overrides = {}) => ({
  uid: 'test-uid',
  email: 'cook@example.com',
  displayName: 'Test Cook',
  emailVerified: true,
  photoURL: null,
  getIdToken: jest.fn(async () => 'test-id-token'),
  ...overrides,
});

let currentUser = null;
const listeners = new Set();

/** Move auth into a signed-in (or signed-out, with `null`) state. */
export const __setUser = (user) => {
  currentUser = user;
  listeners.forEach((l) => l.next?.(user));
};

/** Fail every registered listener — for testing auth error paths. */
export const __emitAuthError = (error = new Error('auth failure')) => {
  listeners.forEach((l) => l.error?.(error));
};

export const __currentUser = () => currentUser;
export const __listenerCount = () => listeners.size;

export const getAuth = jest.fn(() => ({
  get currentUser() {
    return currentUser;
  },
}));
export const connectAuthEmulator = jest.fn();

export const onAuthStateChanged = jest.fn((_auth, a, b) => {
  const handlers =
    typeof a === 'function' ? { next: a, error: b } : { next: a?.next, error: a?.error };
  listeners.add(handlers);
  // The real SDK fires once with the current state on subscribe.
  handlers.next?.(currentUser);
  return () => listeners.delete(handlers);
});

export const onIdTokenChanged = onAuthStateChanged;

export const signInWithEmailAndPassword = jest.fn(async (_auth, email) => {
  const user = __user({ email });
  __setUser(user);
  return { user };
});

export const createUserWithEmailAndPassword = jest.fn(async (_auth, email) => {
  const user = __user({ email, uid: 'new-uid', displayName: null });
  __setUser(user);
  return { user };
});

export const signOut = jest.fn(async () => {
  __setUser(null);
});

export const sendPasswordResetEmail = jest.fn(async () => undefined);
export const updateProfile = jest.fn(async () => undefined);
export const updateEmail = jest.fn(async () => undefined);
export const updatePassword = jest.fn(async () => undefined);
export const reauthenticateWithCredential = jest.fn(async () => ({ user: currentUser }));
export const setPersistence = jest.fn(async () => undefined);
export const browserLocalPersistence = 'local';

export const EmailAuthProvider = {
  credential: jest.fn((email, password) => ({ __credential: true, email, password })),
};

/** Build a Firebase auth error with the `auth/*` code shape the app maps on. */
export const __authError = (code) => Object.assign(new Error(code), { code });

export const __reset = () => {
  currentUser = null;
  listeners.clear();
  signInWithEmailAndPassword.mockImplementation(async (_auth, email) => {
    const user = __user({ email });
    __setUser(user);
    return { user };
  });
  createUserWithEmailAndPassword.mockImplementation(async (_auth, email) => {
    const user = __user({ email, uid: 'new-uid', displayName: null });
    __setUser(user);
    return { user };
  });
  signOut.mockImplementation(async () => {
    __setUser(null);
  });
  sendPasswordResetEmail.mockImplementation(async () => undefined);
  updateProfile.mockImplementation(async () => undefined);
};
