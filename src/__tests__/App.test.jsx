// Whole-app smoke tests: every route in the roadmap must exist, be gated by
// auth, and render inside the shared layout. These catch a route that was
// renamed or a page that was removed from the barrel export.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import App from '../App';
import * as authMock from '../test-utils/mocks/auth';
import * as fs from '../test-utils/mocks/firestore';
import { makeUserProfile } from '../test-utils/factories';

// The service worker is exercised by the E2E suite against a real build.
jest.mock('../serviceWorkerRegistration', () => ({
  register: jest.fn(),
  unregister: jest.fn(),
}));

const signIn = () => {
  const user = authMock.__user();
  authMock.__setUser(user);
  fs.getDoc.mockResolvedValue(fs.__doc(user.uid, makeUserProfile()));
  return user;
};

/**
 * How long a code-split route may take to arrive.
 *
 * Generous on purpose: this covers a dynamic import resolving while the rest of
 * the suite runs in parallel, and the cost of being wrong is a flake that only
 * appears in a full run.
 */
const ROUTE_CHUNK_TIMEOUT = 10_000;

const visit = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
});

describe('routing while signed out', () => {
  it('sends a visitor at the root to the login page', async () => {
    authMock.__setUser(null);
    visit('/');

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });

  it.each([
    '/dashboard',
    '/inventory',
    '/recipes',
    '/meal-plan',
    '/hellofresh',
    '/analytics',
    '/settings',
  ])('keeps %s behind the login gate', async (path) => {
    authMock.__setUser(null);
    visit(path);

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });
});

describe('routing while signed in', () => {
  it.each([
    ['/dashboard', /good (morning|afternoon|evening)/i],
    ['/inventory', /inventory/i],
    ['/recipes', /recipes/i],
    ['/meal-plan', /meal plan/i],
    ['/hellofresh', /hellofresh/i],
    ['/analytics', /analytics/i],
    ['/settings', /settings/i],
  ])('renders %s', async (path, heading) => {
    signIn();
    visit(path);

    // The timeout is explicit because rendering a route is now genuinely
    // asynchronous: App.jsx code-splits every page (roadmap 9.2), so this waits
    // for a dynamic import to resolve and Suspense to swap the fallback out.
    // RTL's default is 1000ms — not a budget anyone chose, and under a full
    // parallel suite the analytics chunk (recharts) does not always make it.
    // This is the wait becoming real, not a slow assertion being papered over.
    expect(
      await screen.findAllByText(heading, {}, { timeout: ROUTE_CHUNK_TIMEOUT })
    ).not.toHaveLength(0);
  });

  it('lands on the dashboard from the root', async () => {
    signIn();
    visit('/');

    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
  });

  it('redirects an unknown URL to the dashboard rather than showing a dead end', async () => {
    signIn();
    visit('/this-page-does-not-exist');

    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
  });

  it('wraps protected pages in the shared layout, including the footer version', async () => {
    signIn();
    visit('/dashboard');

    const { APP_VERSION } = require('../config/version');
    expect(
      await screen.findByText(`v${APP_VERSION}`, {}, { timeout: ROUTE_CHUNK_TIMEOUT })
    ).toBeInTheDocument();
  });
});

describe('app shell', () => {
  it('registers the service worker on mount', () => {
    authMock.__setUser(null);
    const swRegistration = require('../serviceWorkerRegistration');
    visit('/login');

    expect(swRegistration.register).toHaveBeenCalled();
  });

  it('mounts without crashing when Firebase config is present', () => {
    authMock.__setUser(null);
    expect(() => visit('/login')).not.toThrow();
  });
});
