// src/test-utils/mocks/analytics.js
// Manual mock for `firebase/analytics`.
//
// Registered globally in src/setupTests.js so no test can start a real GA4
// measurement session. `isSupported` defaults to true — the interesting cases
// (an unsupported browser, a blocked script) are driven per-test with
// `isSupported.mockResolvedValueOnce(false)`.

const analyticsHandles = [];

export const isSupported = jest.fn(async () => true);

export const getAnalytics = jest.fn((app) => {
  const handle = { app, __analytics: true };
  analyticsHandles.push(handle);
  return handle;
});

export const logEvent = jest.fn();
export const setUserProperties = jest.fn();
export const setUserId = jest.fn();
export const setAnalyticsCollectionEnabled = jest.fn();

/** Every analytics handle created so far, for asserting single-initialisation. */
export const __handles = () => [...analyticsHandles];

export const __reset = () => {
  analyticsHandles.length = 0;
  isSupported.mockImplementation(async () => true);
  getAnalytics.mockImplementation((app) => {
    const handle = { app, __analytics: true };
    analyticsHandles.push(handle);
    return handle;
  });
};
