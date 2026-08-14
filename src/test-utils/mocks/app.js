// src/test-utils/mocks/app.js
// Manual mock for `firebase/app` — keeps initializeApp from touching the network.

const apps = [];

export const initializeApp = jest.fn((options, name = '[DEFAULT]') => {
  const app = { name, options };
  apps.push(app);
  return app;
});

export const getApp = jest.fn((name = '[DEFAULT]') => apps.find((a) => a.name === name) ?? apps[0]);
export const getApps = jest.fn(() => apps);
export const deleteApp = jest.fn(async () => undefined);

export const __reset = () => {
  apps.length = 0;
};
