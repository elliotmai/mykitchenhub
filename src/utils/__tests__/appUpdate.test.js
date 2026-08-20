// Applying an update, rather than asking a service worker nicely and hoping.
//
// Two things matter here and neither is the happy path. The reload must happen
// whatever else fails — a button that silently does nothing is the bug being
// fixed — and the clear-out must not take the caches the incoming worker just
// built, or the fridge tablet comes back from an update with no offline.

import {
  applyUpdate,
  clearRuntimeCaches,
  clearUpdateAttempt,
  didUpdateStall,
  forceReinstall,
  getWaitingWorker,
  isApplyingUpdate,
  markUpdateAttempt,
  SKIP_WAITING,
  UPDATE_STAGES,
} from '../appUpdate';

/** A CacheStorage-alike holding the given cache names. */
const mockCaches = (names, { failOn = [] } = {}) => {
  const deleted = [];
  global.caches = {
    keys: jest.fn(async () => names),
    delete: jest.fn(async (name) => {
      if (failOn.includes(name)) throw new Error('locked');
      deleted.push(name);
      return true;
    }),
  };
  return deleted;
};

/** A ServiceWorkerContainer-alike with an optional waiting worker. */
const mockServiceWorker = ({ waiting = null } = {}) => {
  const listeners = {};
  const container = {
    getRegistration: jest.fn(async () => ({ waiting })),
    addEventListener: jest.fn((name, fn) => {
      listeners[name] = fn;
    }),
    removeEventListener: jest.fn(),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
    writable: true,
  });
  return { container, fire: (name) => listeners[name]?.() };
};

afterEach(() => {
  delete global.caches;
  sessionStorage.clear();
  jest.useRealTimers();
});

describe('clearRuntimeCaches', () => {
  it('empties the runtime caches', async () => {
    const deleted = mockCaches(['static-assets-v1', 'api-cache-v1', 'recipe-images-v1']);

    const cleared = await clearRuntimeCaches();

    expect(deleted.sort()).toEqual(['api-cache-v1', 'recipe-images-v1', 'static-assets-v1']);
    expect(cleared).toHaveLength(3);
  });

  it('keeps the two caches the incoming worker just built', async () => {
    // Both are written during the new worker's install, which has already
    // happened by the time it is waiting — so they hold the *new* content.
    // Deleting them would leave the app with no shell and no offline page
    // until the next release installed.
    const deleted = mockCaches([
      'workbox-precache-v2-https://mykitchenhub.web.app/',
      'offline-fallback-v1',
      'static-assets-v1',
    ]);

    const cleared = await clearRuntimeCaches();

    expect(deleted).toEqual(['static-assets-v1']);
    expect(cleared).toEqual(['static-assets-v1']);
  });

  it('carries on when one cache refuses to go', async () => {
    const deleted = mockCaches(['static-assets-v1', 'api-cache-v1'], {
      failOn: ['static-assets-v1'],
    });

    await expect(clearRuntimeCaches()).resolves.toBeDefined();
    expect(deleted).toEqual(['api-cache-v1']);
  });

  it('is a no-op where CacheStorage does not exist', async () => {
    delete global.caches;

    await expect(clearRuntimeCaches()).resolves.toEqual([]);
  });
});

describe('getWaitingWorker', () => {
  it('finds a worker installed and waiting to take over', async () => {
    const waiting = { id: 'sw-1' };
    mockServiceWorker({ waiting });

    await expect(getWaitingWorker()).resolves.toBe(waiting);
  });

  it('is null when nothing is waiting', async () => {
    mockServiceWorker({ waiting: null });

    await expect(getWaitingWorker()).resolves.toBeNull();
  });

  it('is null rather than throwing when the registration lookup fails', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: jest.fn(async () => {
          throw new Error('nope');
        }),
      },
      configurable: true,
      writable: true,
    });

    await expect(getWaitingWorker()).resolves.toBeNull();
  });
});

describe('applyUpdate', () => {
  it('tells the waiting worker to take over, clears up, and reloads', async () => {
    const waiting = { postMessage: jest.fn() };
    const { fire } = mockServiceWorker({ waiting });
    mockCaches(['static-assets-v1']);
    const reload = jest.fn();

    const done = applyUpdate({ reload });
    // Let the registration lookup settle, then let the worker take over.
    await Promise.resolve();
    await Promise.resolve();
    fire('controllerchange');
    const result = await done;

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: SKIP_WAITING });
    expect(result.tookControl).toBe(true);
    expect(result.cleared).toEqual(['static-assets-v1']);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports each stage in order, so the card can show progress', async () => {
    mockServiceWorker({ waiting: null });
    mockCaches([]);
    const stages = [];

    await applyUpdate({ onStage: (s) => stages.push(s), reload: jest.fn() });

    expect(stages).toEqual(['activating', 'clearing', 'reloading']);
    // Every stage the mechanism reports has copy to render. A stage with no
    // entry would show the fallback and read as a stall.
    stages.forEach((stage) => expect(UPDATE_STAGES[stage]).toBeTruthy());
  });

  it('reloads anyway when the worker never takes control', async () => {
    // The whole point. Whatever the service worker does or fails to do, the
    // page reloads — a needless reload costs a second, a button that does
    // nothing costs the user's trust in the update.
    const waiting = { postMessage: jest.fn() };
    mockServiceWorker({ waiting });
    mockCaches([]);
    const reload = jest.fn();

    const result = await applyUpdate({ reload, timeoutMs: 0 });

    expect(result.tookControl).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when there is no waiting worker at all', async () => {
    mockServiceWorker({ waiting: null });
    mockCaches([]);
    const reload = jest.fn();

    await applyUpdate({ reload });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads even when the waiting worker has gone redundant', async () => {
    const waiting = {
      postMessage: jest.fn(() => {
        throw new Error('InvalidStateError');
      }),
    };
    mockServiceWorker({ waiting });
    mockCaches([]);
    const reload = jest.fn();

    await expect(applyUpdate({ reload, timeoutMs: 0 })).resolves.toBeDefined();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clears the caches before reloading, not after', async () => {
    // Reload first and the clear-out is abandoned mid-flight by the
    // navigation, leaving exactly the stale files it was meant to remove.
    const order = [];
    mockServiceWorker({ waiting: null });
    global.caches = {
      keys: jest.fn(async () => ['static-assets-v1']),
      delete: jest.fn(async (name) => {
        order.push(`delete:${name}`);
        return true;
      }),
    };

    await applyUpdate({ reload: () => order.push('reload') });

    expect(order).toEqual(['delete:static-assets-v1', 'reload']);
  });

  it('flags that an update is in flight, so nothing else reloads underneath it', async () => {
    mockServiceWorker({ waiting: null });
    mockCaches([]);
    let flagDuringClear = null;

    await applyUpdate({
      reload: jest.fn(),
      onStage: (stage) => {
        if (stage === 'clearing') flagDuringClear = isApplyingUpdate();
      },
    });

    expect(flagDuringClear).toBe(true);
  });
});

/* --------------------------------------------------------------------------
   The stall guard

   The reload at the end of applyUpdate is unconditional, which is right — but
   it means a worker that never activates lands the page back on the same build
   with the same worker still waiting, and the card comes straight back. That
   reads from the fridge as "it keeps asking me to update".
   -------------------------------------------------------------------------- */

describe('recognising an update that did not take', () => {
  it('reports a stall when the reload landed on the build that asked for it', () => {
    markUpdateAttempt('0.10.5');

    expect(didUpdateStall('0.10.5')).toBe(true);
  });

  it('reports no stall when the build actually moved', () => {
    markUpdateAttempt('0.10.5');

    expect(didUpdateStall('0.10.6')).toBe(false);
  });

  it('reports no stall when no update was attempted at all', () => {
    expect(didUpdateStall('0.10.5')).toBe(false);
  });

  it('forgets the attempt once it has been reported', () => {
    markUpdateAttempt('0.10.5');
    clearUpdateAttempt();

    // Otherwise a tab reloaded by hand would go on claiming an update failed.
    expect(didUpdateStall('0.10.5')).toBe(false);
  });

  it('survives storage being unavailable rather than taking the app down', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => markUpdateAttempt('0.10.5')).not.toThrow();
    expect(didUpdateStall('0.10.5')).toBe(false);

    setItem.mockRestore();
    getItem.mockRestore();
  });

  it('writes the marker down before applyUpdate reloads', async () => {
    mockServiceWorker({ waiting: null });
    mockCaches([]);

    await applyUpdate({ timeoutMs: 1, reload: () => {}, version: '0.10.5' });

    expect(didUpdateStall('0.10.5')).toBe(true);
  });

  it('leaves no marker when no version was handed in', async () => {
    mockServiceWorker({ waiting: null });
    mockCaches([]);

    await applyUpdate({ timeoutMs: 1, reload: () => {} });

    expect(sessionStorage.getItem('mykitchenhub.updateAttempt')).toBeNull();
  });
});

describe('forceReinstall', () => {
  const mockRegistrations = (count) => {
    const unregister = jest.fn(async () => true);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistrations: jest.fn(async () =>
          Array.from({ length: count }, () => ({ unregister }))
        ),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      configurable: true,
      writable: true,
    });
    return unregister;
  };

  it('unregisters every worker, so none can serve the old shell back', async () => {
    const unregister = mockRegistrations(2);
    mockCaches([]);

    await forceReinstall({ reload: () => {} });

    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it('empties every cache, precache included', async () => {
    mockRegistrations(1);
    // applyUpdate spares these two; this path does not, because the worker
    // that owns them is being thrown away.
    const deleted = mockCaches([
      'workbox-precache-v2-https://mykitchenhub.web.app/',
      'offline-fallback-v1',
      'api-cache-v1',
    ]);

    await forceReinstall({ reload: () => {} });

    expect(deleted).toHaveLength(3);
  });

  it('reloads even when unregistering throws', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistrations: jest.fn(async () => {
          throw new Error('nope');
        }),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      configurable: true,
      writable: true,
    });
    mockCaches([]);
    const reload = jest.fn();

    await forceReinstall({ reload });

    expect(reload).toHaveBeenCalled();
  });

  it('clears the stall marker, so the next load starts clean', async () => {
    mockRegistrations(1);
    mockCaches([]);
    markUpdateAttempt('0.10.5');

    await forceReinstall({ reload: () => {} });

    expect(didUpdateStall('0.10.5')).toBe(false);
  });
});
