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
  scrubParams,
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

// What this app knows about a cook is their email, what they eat, what they
// buy and where they shop. None of it may reach a GA4 property — so the module
// drops it rather than trusting every future call site to remember.
describe('scrubParams', () => {
  it.each([
    ['uid', { uid: 'abc123' }],
    ['userId', { userId: 'abc123' }],
    ['user_id', { user_id: 'abc123' }],
    ['email', { email: 'cook@example.com' }],
    ['e-mail', { 'e-mail': 'cook@example.com' }],
    ['name', { name: 'Grandma Chili' }],
    ['recipe_name', { recipe_name: 'Grandma Chili' }],
    ['recipeName', { recipeName: 'Grandma Chili' }],
    ['item_name', { item_name: 'salmon' }],
    ['store_name', { store_name: 'Costco' }],
    ['displayName', { displayName: 'Eli' }],
    ['phone', { phone: '+15551234567' }],
    ['phoneNumber', { phoneNumber: '+15551234567' }],
    ['address', { address: '1 Kitchen Way' }],
    ['notes', { notes: 'the good knife is blunt' }],
    ['token', { token: 'ya29.abc' }],
  ])('drops %s', (_label, params) => {
    expect(scrubParams(params)).toEqual({});
  });

  it('drops an email-shaped value whatever the parameter is called', () => {
    expect(scrubParams({ contact: 'cook@example.com' })).toEqual({});
  });

  it('keeps the counts and categories that are the point of an event', () => {
    expect(
      scrubParams({ source: 'legacy', item_count: 4, difficulty: 'easy', degraded: false })
    ).toEqual({ source: 'legacy', item_count: 4, difficulty: 'easy', degraded: false });
  });

  it('keeps the safe half of a mixed payload rather than dropping the event', () => {
    expect(scrubParams({ source: 'manual', recipe_name: 'Grandma Chili' })).toEqual({
      source: 'manual',
    });
  });

  it('survives being handed nothing, or something that is not an object', () => {
    expect(scrubParams()).toEqual({});
    expect(scrubParams(null)).toEqual({});
    expect(scrubParams('nope')).toEqual({});
  });
});

describe('logAppEvent scrubbing', () => {
  beforeEach(async () => {
    withEnv({ REACT_APP_FIREBASE_MEASUREMENT_ID: 'G-REAL' });
    await initAnalytics();
  });

  it('never sends a food name, an email or a uid, even when a caller passes one', () => {
    expect(
      logAppEvent('recipe_cooked', {
        source: 'legacy',
        recipe_name: 'Grandma Chili',
        email: 'cook@example.com',
        uid: 'abc123',
      })
    ).toBe(true);

    expect(analyticsSdk.logEvent).toHaveBeenCalledWith(expect.anything(), 'recipe_cooked', {
      source: 'legacy',
    });

    // Nothing identifying anywhere in what was actually sent.
    const sent = JSON.stringify(analyticsSdk.logEvent.mock.calls);
    expect(sent).not.toMatch(/Grandma Chili|cook@example\.com|abc123/);
  });

  it('still records the event when every parameter had to be dropped', () => {
    // The count is the useful part; losing the dimension is the safe trade.
    expect(logAppEvent('recipe_cooked', { recipe_name: 'Grandma Chili' })).toBe(true);
    expect(analyticsSdk.logEvent).toHaveBeenCalledWith(expect.anything(), 'recipe_cooked', {});
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
