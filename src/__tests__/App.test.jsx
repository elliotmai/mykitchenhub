// Whole-app smoke tests: every route in the roadmap must exist, be gated by
// auth, and render inside the shared layout. These catch a route that was
// renamed or a page that was removed from the barrel export.

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../App';
import * as authMock from '../test-utils/mocks/auth';
import * as fs from '../test-utils/mocks/firestore';
import { makeUserProfile } from '../test-utils/factories';

// The service worker is exercised by the E2E suite against a real build.
jest.mock('../serviceWorkerRegistration', () => ({
  register: jest.fn(),
  unregister: jest.fn(),
}));

jest.mock('../utils/appUpdate', () => ({
  ...jest.requireActual('../utils/appUpdate'),
  applyUpdate: jest.fn(async ({ onStage }) => {
    onStage('activating');
    onStage('clearing');
    onStage('reloading');
    return { tookControl: true, cleared: [] };
  }),
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

  it('offers the update when the registration says one is waiting', async () => {
    authMock.__setUser(null);
    const swRegistration = require('../serviceWorkerRegistration');
    visit('/login');

    // Fire the callback the app handed to register(), the way a waiting worker
    // would an hour into a session on the fridge tablet.
    const { onUpdate } = swRegistration.register.mock.calls.at(-1)[0];
    await act(async () => onUpdate({ id: 'sw-1' }));

    expect(await screen.findByText('Update Available')).toBeInTheDocument();
  });

  it('shows the update running instead of hiding the card', async () => {
    // The old handler hid the card on its first line and left the page exactly
    // as it was for however long the worker took — the "it does nothing" bug.
    const user = userEvent.setup();
    authMock.__setUser(null);
    const swRegistration = require('../serviceWorkerRegistration');
    const { applyUpdate } = require('../utils/appUpdate');
    visit('/login');

    const { onUpdate } = swRegistration.register.mock.calls.at(-1)[0];
    await act(async () => onUpdate({ id: 'sw-1' }));
    await user.click(await screen.findByRole('button', { name: /update now/i }));

    expect(applyUpdate).toHaveBeenCalledTimes(1);
    // Still on screen, now reporting the last stage it reached.
    expect(screen.getByText('Updating')).toBeInTheDocument();
    expect(screen.getByText(/reloading/i)).toBeInTheDocument();
  });

  it('mounts without crashing when Firebase config is present', () => {
    authMock.__setUser(null);
    expect(() => visit('/login')).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // The chunk reload guard, and why booting must not touch it
  //
  // lazyWithRetry reloads the page once when a route's chunk is missing, on the
  // theory that a deploy renamed it and the new index.html knows the new name.
  // A session flag is what stops that becoming a loop when the chunk is simply
  // gone for good.
  //
  // App used to clear that flag from its mount effect, reasoning that the app
  // had booted so the stale chunk was behind it. But booting proves nothing
  // about the chunk: effects run after paint, and the chunk's rejection lands a
  // network round trip later. So the reload cleared the guard, the chunk failed
  // again, and the page reloaded again, for as long as the chunk stayed
  // missing. It is now cleared by a chunk that actually loads.
  // -------------------------------------------------------------------------
  it('leaves the chunk reload guard alone while booting, so a missing chunk cannot loop', async () => {
    authMock.__setUser(null);
    sessionStorage.setItem('mykitchenhub.chunkReload', '1');

    visit('/login');

    // Waiting gets us past the mount effects, which is where the clear was.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    );

    expect(sessionStorage.getItem('mykitchenhub.chunkReload')).toBe('1');
  });
});
