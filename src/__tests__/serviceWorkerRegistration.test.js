// src/__tests__/serviceWorkerRegistration.test.js
//
// The registration is what makes this a progressive web app rather than a
// website with a manifest, and it had been silently doing nothing: register()
// is called from a useEffect, React runs effects after paint, and the function
// attached its work to a `load` event that had already fired by then. Nothing
// looked broken — the file was served, CI's "does build/service-worker.js
// exist" check passed — the app simply had no precache and no offline.
//
// e2e/navigation.spec.js proves the real browser ends up controlled. This
// covers the branch that made it not, which only shows up when `load` has
// already gone.

const mockWorkbox = {
  addEventListener: jest.fn(),
  register: jest.fn(() => Promise.resolve({ update: jest.fn(() => Promise.resolve()) })),
  messageSkipWaiting: jest.fn(),
};

jest.mock('workbox-window', () => ({
  Workbox: jest.fn(() => mockWorkbox),
}));

/** Re-imports the module with NODE_ENV forced to production. */
const loadModule = () => {
  let mod;
  jest.isolateModules(() => {
    mod = require('../serviceWorkerRegistration');
  });
  return mod;
};

/** Pretends the document is at a given lifecycle point. */
const setReadyState = (value) => {
  Object.defineProperty(document, 'readyState', { value, configurable: true });
};

const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  jest.clearAllMocks();
  // NODE_ENV is the gate on the whole function; the browser is always
  // "production" by the time this matters.
  process.env.NODE_ENV = 'production';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(window, 'addEventListener');
});

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
  jest.restoreAllMocks();
  setReadyState('complete');
});

describe('register', () => {
  it('registers straight away when the page has already loaded', async () => {
    setReadyState('complete');

    loadModule().register();

    // The bug: this waited for a `load` that had already been and gone.
    expect(mockWorkbox.register).toHaveBeenCalled();
  });

  it('waits for load when the page is still loading', () => {
    setReadyState('loading');

    loadModule().register();

    expect(mockWorkbox.register).not.toHaveBeenCalled();

    const loadListener = window.addEventListener.mock.calls.find(([type]) => type === 'load');
    expect(loadListener).toBeDefined();

    loadListener[1]();
    expect(mockWorkbox.register).toHaveBeenCalled();
  });

  it('registers once, not once per load event', () => {
    setReadyState('loading');

    loadModule().register();

    const [, , options] = window.addEventListener.mock.calls.find(([type]) => type === 'load');
    expect(options).toEqual({ once: true });
  });

  it('does nothing outside production', () => {
    process.env.NODE_ENV = 'development';
    setReadyState('complete');

    loadModule().register();

    expect(mockWorkbox.register).not.toHaveBeenCalled();
  });
});

describe('taking control', () => {
  /** The handler the module attached for a given workbox event. */
  const handlerFor = (event) =>
    mockWorkbox.addEventListener.mock.calls.find(([name]) => name === event)?.[1];

  let reload;

  beforeEach(() => {
    reload = jest.fn();
    // register() reads window.location.href, so the stub has to be a location,
    // not just a reload function — otherwise the *next* test in the file fails
    // on `new URL(undefined)` rather than on anything it is testing.
    delete window.location;
    window.location = { reload, href: 'http://localhost/', origin: 'http://localhost' };

    setReadyState('complete');
    loadModule().register();
  });

  it('does not reload when the first worker claims the page', () => {
    // The worker calls clientsClaim(), so this fires on every first visit.
    // Reloading there throws away a page that has just finished loading.
    handlerFor('controlling')({ isUpdate: false });

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when an update takes over, so the new build is what runs', () => {
    handlerFor('controlling')({ isUpdate: true });

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
