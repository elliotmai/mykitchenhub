// src/setupTests.js
// Global Jest setup — runs before every test file.
//
// Three jobs:
//   1. Load jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...).
//   2. Replace the whole Firebase SDK with the manual mocks in
//      src/test-utils/mocks/ so no test can reach a real backend.
//   3. Polyfill the browser APIs jsdom is missing that react-bootstrap and the
//      PWA components rely on.
//
// The Firebase mocks are registered here rather than per-file so that a test
// which forgets to mock still cannot hit the network. Tests that want to drive
// a specific response import the mock module directly and stub it:
//
//   import * as fs from '../test-utils/mocks/firestore';
//   fs.getDocs.mockResolvedValueOnce(fs.__querySnapshot([...]));

import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Firebase config — set before services/firebase.js is imported so its
// "missing config" guard stays quiet and initializeApp gets real-looking input.
// ---------------------------------------------------------------------------
process.env.REACT_APP_FIREBASE_API_KEY = 'test-api-key';
process.env.REACT_APP_FIREBASE_AUTH_DOMAIN = 'test.firebaseapp.com';
process.env.REACT_APP_FIREBASE_PROJECT_ID = 'test-project';
process.env.REACT_APP_FIREBASE_STORAGE_BUCKET = 'test-project.appspot.com';
process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID = '1234567890';
process.env.REACT_APP_FIREBASE_APP_ID = '1:1234567890:web:abcdef';
process.env.REACT_APP_FIREBASE_FUNCTIONS_URL = 'https://functions.test/mykitchenhub';

// ---------------------------------------------------------------------------
// Firebase SDK mocks
// ---------------------------------------------------------------------------
jest.mock('firebase/app', () => require('./test-utils/mocks/app'));
jest.mock('firebase/auth', () => require('./test-utils/mocks/auth'));
jest.mock('firebase/firestore', () => require('./test-utils/mocks/firestore'));
jest.mock('firebase/storage', () => require('./test-utils/mocks/storage'));
jest.mock('firebase/functions', () => require('./test-utils/mocks/functions'));

// ---------------------------------------------------------------------------
// jsdom polyfills
// ---------------------------------------------------------------------------
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated, still used by some libs
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  });
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

window.scrollTo = jest.fn();

// jsdom has no object URLs; components use them for local image previews.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = jest.fn(() => 'blob:mock-object-url');
  URL.revokeObjectURL = jest.fn();
}

// react-bootstrap measures scrollbar width when opening modals.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = jest.fn();
}

// The PWA layer registers a service worker on mount; jsdom has no SW.
if (!navigator.serviceWorker) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: jest.fn(() => Promise.resolve({ addEventListener: jest.fn(), update: jest.fn() })),
      ready: Promise.resolve({ unregister: jest.fn() }),
      getRegistration: jest.fn(() => Promise.resolve(undefined)),
      addEventListener: jest.fn(),
      controller: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Per-test reset
//
// `resetMocks` is turned off in package.json (it would wipe the manual mocks'
// implementations), so state is cleared explicitly here instead.
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();

  require('./test-utils/mocks/app').__reset();
  require('./test-utils/mocks/auth').__reset();
  require('./test-utils/mocks/firestore').__reset();
  require('./test-utils/mocks/storage').__reset();
  require('./test-utils/mocks/functions').__reset();
});
