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
  register: jest.fn(),
  messageSkipWaiting: jest.fn(),
};

jest.mock('workbox-window', () => ({
  Workbox: jest.fn(() => mockWorkbox),
}));

/**
 * A ServiceWorkerRegistration-alike.
 *
 * The module watches this object rather than workbox-window's lifecycle
 * events, so this — not the workbox mock — is what the update tests drive.
 */
const makeRegistration = ({ waiting = null, installing = null } = {}) => ({
  waiting,
  installing,
  addEventListener: jest.fn(),
  update: jest.fn(() => Promise.resolve()),
});

/** Run the update check the module attached to `visibilitychange`. */
const runUpdateCheck = async (registration) => {
  const handler = document.addEventListener.mock.calls.find(
    ([name]) => name === 'visibilitychange'
  )?.[1];
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
  handler?.();
  await flush();
};

/**
 * Let the register() promise chain settle, and the announce delay elapse.
 *
 * The announcer re-reads `registration.waiting` after a beat, to tell a real
 * update from a first install passing through `waiting` on its way to
 * activating — so a test that does not let that timer run sees nothing.
 */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  jest.advanceTimersByTime(500);
  await Promise.resolve();
};

/** Whether a service worker was already controlling the page. */
const setController = (controller) => {
  navigator.serviceWorker.controller = controller;
};

/**
 * Re-imports the module with NODE_ENV forced to production.
 *
 * `appUpdate` is pulled from inside the same isolated registry, because the
 * flag the two modules share is module state — a copy required from outside
 * would be a different module with a different flag, and the test would pass
 * for the wrong reason.
 */
let loadedAppUpdate;
const loadModule = () => {
  let mod;
  jest.isolateModules(() => {
    mod = require('../serviceWorkerRegistration');
    loadedAppUpdate = require('../utils/appUpdate');
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
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(window, 'addEventListener');
  jest.spyOn(document, 'addEventListener');

  // jsdom has no ServiceWorkerContainer at all.
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { addEventListener: jest.fn(), controller: null, getRegistration: jest.fn() },
    configurable: true,
    writable: true,
  });

  mockWorkbox.register.mockResolvedValue(makeRegistration());
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
});

afterEach(() => {
  jest.useRealTimers();
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
  let reload;

  /** Fire a controllerchange at whatever the module registered for it. */
  const fireControllerChange = () => {
    const handler = navigator.serviceWorker.addEventListener.mock.calls.find(
      ([name]) => name === 'controllerchange'
    )?.[1];
    handler?.();
  };

  beforeEach(() => {
    reload = jest.fn();
    // register() reads window.location.href, so the stub has to be a location,
    // not just a reload function — otherwise the *next* test in the file fails
    // on `new URL(undefined)` rather than on anything it is testing.
    delete window.location;
    window.location = { reload, href: 'http://localhost/', origin: 'http://localhost' };

    setReadyState('complete');
  });

  it('does not reload when the first worker claims the page', () => {
    // The worker calls clientsClaim(), so this fires on every first visit.
    // Reloading there throws away a page that has just finished loading.
    setController(null);
    loadModule().register();

    fireControllerChange();

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when an update takes over, so the new build is what runs', () => {
    setController({});
    loadModule().register();

    fireControllerChange();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reads the controller from the browser, not from workbox-window', () => {
    // The bug this replaced: workbox-window calls any update found more than
    // sixty seconds after register() "external" and then reports it with
    // isUpdate unset — which is every update on a page left open, so the
    // reload never fired on the one device that never closes the tab.
    // navigator.serviceWorker.controller has no such cutoff.
    setController({});
    loadModule().register();

    expect(mockWorkbox.addEventListener.mock.calls.map(([name]) => name)).not.toContain(
      'controlling'
    );
  });

  it('stands aside while the app is applying an update itself', async () => {
    // applyUpdate() asks for the controller change and still has caches to
    // clear before it reloads. Reloading here would cut that short.
    setController({});
    loadModule().register();

    const done = loadedAppUpdate.applyUpdate({ reload: jest.fn(), timeoutMs: 0 });
    fireControllerChange();
    await done;

    expect(reload).not.toHaveBeenCalled();
  });
});

describe('noticing a waiting update', () => {
  let onUpdate;

  beforeEach(() => {
    onUpdate = jest.fn();
    setReadyState('complete');
    setController({});
  });

  it('reports a worker that was already waiting when the page loaded', async () => {
    // Installed by a previous visit that was closed before it could take over.
    const waiting = { id: 'sw-1' };
    mockWorkbox.register.mockResolvedValue(makeRegistration({ waiting }));

    loadModule().register({ onUpdate });
    await flush();

    expect(onUpdate).toHaveBeenCalledWith(waiting);
  });

  it('reports one found by a later update check — the case that never closes', async () => {
    // The fridge tablet finds every update this way, hours after registering.
    const registration = makeRegistration({ waiting: null });
    mockWorkbox.register.mockResolvedValue(registration);

    loadModule().register({ onUpdate });
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    const waiting = { id: 'sw-2' };
    registration.waiting = waiting;
    await runUpdateCheck(registration);

    expect(onUpdate).toHaveBeenCalledWith(waiting);
  });

  it('does not nag: the same waiting worker is reported once', async () => {
    const registration = makeRegistration({ waiting: { id: 'sw-1' } });
    mockWorkbox.register.mockResolvedValue(registration);

    loadModule().register({ onUpdate });
    await flush();
    await runUpdateCheck(registration);
    await runUpdateCheck(registration);

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports again when a genuinely newer build arrives', async () => {
    const registration = makeRegistration({ waiting: { id: 'sw-1' } });
    mockWorkbox.register.mockResolvedValue(registration);

    loadModule().register({ onUpdate });
    await flush();

    registration.waiting = { id: 'sw-2' };
    await runUpdateCheck(registration);

    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenLastCalledWith({ id: 'sw-2' });
  });

  it('says nothing on a first install, which is not an update', async () => {
    // A brand-new worker passes through `waiting` on its way to activating,
    // because there is no controller to wait for. Announcing that showed an
    // "Update Available" card to someone who had just arrived — and on the
    // mobile layout it sat right on top of the nav bar.
    setController(null);
    mockWorkbox.register.mockResolvedValue(makeRegistration({ waiting: { id: 'sw-1' } }));

    loadModule().register({ onUpdate });
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('says nothing about a worker that stops waiting a moment later', async () => {
    // The same transient, caught on the second read rather than the first.
    const registration = makeRegistration({ waiting: { id: 'sw-1' } });
    mockWorkbox.register.mockResolvedValue(registration);

    loadModule().register({ onUpdate });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    registration.waiting = null; // activated before the settle delay elapsed
    jest.advanceTimersByTime(500);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps checking after a failed check, rather than giving up', async () => {
    const registration = makeRegistration({ waiting: null });
    registration.update.mockRejectedValueOnce(new Error('offline'));
    mockWorkbox.register.mockResolvedValue(registration);

    loadModule().register({ onUpdate });
    await flush();
    await runUpdateCheck(registration);

    registration.waiting = { id: 'sw-1' };
    await runUpdateCheck(registration);

    expect(onUpdate).toHaveBeenCalledWith({ id: 'sw-1' });
  });
});
