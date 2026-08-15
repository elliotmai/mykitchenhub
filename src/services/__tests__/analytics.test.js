// Analytics is optional, and the interesting behaviour is all in the ways it
// declines to switch on. Every one of those has to leave the app working and
// leave the module safe to call — that is what these assert.

import * as analyticsSdk from '../../test-utils/mocks/analytics';
import { APP_VERSION } from '../../config/version';
import {
  __resetAnalytics,
  analyticsDisabledReason,
  configProblem,
  initAnalytics,
  isAnalyticsEnabled,
  logAppEvent,
} from '../analytics';

const ORIGINAL_ENV = { ...process.env };

/** Point the module at a given environment; it reads process.env per call. */
const withEnv = (env = {}) => {
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
};

beforeEach(() => {
  // The live handle is a module-level singleton by design, so it is reset here
  // rather than by reloading the module — reloading would hand the module a
  // different copy of the mocked SDK than the one this file asserts against.
  __resetAnalytics();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('configProblem', () => {
  it('reports the emulators before anything else — a local build must not report', () => {
    expect(
      configProblem({
        REACT_APP_USE_EMULATORS: 'true',
        REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL',
      })
    ).toBe('emulators');
  });

  it('reports a missing measurement id', () => {
    expect(configProblem({})).toBe('no-measurement-id');
  });

  it('is happy with a measurement id and no emulators', () => {
    expect(configProblem({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' })).toBeNull();
  });
});

describe('initAnalytics', () => {
  it('starts analytics when the build is configured for it', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });

    await expect(initAnalytics()).resolves.toBe(true);

    expect(analyticsSdk.getAnalytics).toHaveBeenCalledTimes(1);
    expect(isAnalyticsEnabled()).toBe(true);
    expect(analyticsDisabledReason()).toBeNull();
  });

  it('stamps the build onto the session, so a report can tell releases apart', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    await initAnalytics();

    expect(analyticsSdk.setUserProperties).toHaveBeenCalledWith(expect.anything(), {
      app_version: APP_VERSION,
    });
  });

  it('stays off with no measurement id, and says why', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: undefined });

    await expect(initAnalytics()).resolves.toBe(false);

    expect(analyticsSdk.getAnalytics).not.toHaveBeenCalled();
    expect(isAnalyticsEnabled()).toBe(false);
    expect(analyticsDisabledReason()).toBe('no-measurement-id');
  });

  it('stays off against the emulators, even with a measurement id', async () => {
    // Otherwise every end-to-end run and every local session would land in the
    // production GA4 property.
    withEnv({
      REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL',
      REACT_APP_USE_EMULATORS: 'true',
    });

    await expect(initAnalytics()).resolves.toBe(false);

    expect(analyticsSdk.getAnalytics).not.toHaveBeenCalled();
    expect(analyticsDisabledReason()).toBe('emulators');
  });

  it('stays off in a browser that cannot support it', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    analyticsSdk.isSupported.mockResolvedValueOnce(false);

    await expect(initAnalytics()).resolves.toBe(false);

    expect(analyticsSdk.getAnalytics).not.toHaveBeenCalled();
    expect(analyticsDisabledReason()).toBe('unsupported-browser');
  });

  it('survives a blocked measurement script rather than taking the page down', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    analyticsSdk.getAnalytics.mockImplementationOnce(() => {
      throw new Error('ERR_BLOCKED_BY_CLIENT');
    });

    await expect(initAnalytics()).resolves.toBe(false);

    expect(isAnalyticsEnabled()).toBe(false);
    expect(analyticsDisabledReason()).toBe('unavailable');
  });

  it('survives isSupported itself rejecting', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    analyticsSdk.isSupported.mockRejectedValueOnce(new Error('no indexedDB'));

    await expect(initAnalytics()).resolves.toBe(false);
    expect(analyticsDisabledReason()).toBe('unavailable');
  });

  it('only ever starts one measurement session, however often it is called', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });

    await Promise.all([initAnalytics(), initAnalytics(), initAnalytics()]);

    expect(analyticsSdk.getAnalytics).toHaveBeenCalledTimes(1);
    expect(analyticsSdk.setUserProperties).toHaveBeenCalledTimes(1);
  });
});

describe('logAppEvent', () => {
  it('records an event once analytics is on', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    await initAnalytics();

    expect(logAppEvent('recipe_cooked', { source: 'legacy' })).toBe(true);
    expect(analyticsSdk.logEvent).toHaveBeenCalledWith(expect.anything(), 'recipe_cooked', {
      source: 'legacy',
    });
  });

  it('is a no-op, not a throw, when analytics never started', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: undefined });
    await initAnalytics();

    expect(logAppEvent('recipe_cooked')).toBe(false);
    expect(analyticsSdk.logEvent).not.toHaveBeenCalled();
  });

  it('is a no-op before init has been called at all', () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });

    expect(logAppEvent('recipe_cooked')).toBe(false);
    expect(analyticsSdk.logEvent).not.toHaveBeenCalled();
  });

  it('ignores an event with no name', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    await initAnalytics();

    expect(logAppEvent('')).toBe(false);
    expect(analyticsSdk.logEvent).not.toHaveBeenCalled();
  });

  it('swallows a failure inside the SDK — a metric is never worth an error', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    await initAnalytics();

    analyticsSdk.logEvent.mockImplementationOnce(() => {
      throw new Error('transport gone');
    });

    expect(logAppEvent('recipe_cooked')).toBe(false);
  });

  it('defaults its parameters, so a bare event name is enough', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    await initAnalytics();

    logAppEvent('app_opened');
    expect(analyticsSdk.logEvent).toHaveBeenCalledWith(expect.anything(), 'app_opened', {});
  });
});

describe('__resetAnalytics', () => {
  it('lets a fresh init run after a reset', async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    await initAnalytics();

    __resetAnalytics();

    expect(isAnalyticsEnabled()).toBe(false);
    expect(analyticsDisabledReason()).toBe('not-initialised');

    await initAnalytics();
    expect(analyticsSdk.getAnalytics).toHaveBeenCalledTimes(2);
  });
});
