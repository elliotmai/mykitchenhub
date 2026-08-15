// src/test-utils/index.js
// Custom render helpers. Import from here instead of @testing-library/react:
//
//   import { renderWithProviders, screen, userEvent } from '../../test-utils';
//
// This re-exports everything RTL exports, so there's one import in each test.

/* eslint-disable import/export */
import React from 'react';
import { render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../components/Common';
import * as authMock from './mocks/auth';
import * as firestoreMock from './mocks/firestore';
import { makeUserProfile } from './factories';

export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
export * as authMock from './mocks/auth';
export * as firestoreMock from './mocks/firestore';
export * as storageMock from './mocks/storage';
export * as functionsMock from './mocks/functions';
export * from './factories';
export * from './humanErrors';

/**
 * Put the mocked backend into a signed-in state *before* rendering.
 *
 * AuthProvider reads the user synchronously from onAuthStateChanged and then
 * fetches the profile doc, so both have to be primed up front.
 *
 * @param {object|null} user - Firebase User-alike, or null for signed out.
 * @param {object|null} userProfile - the users/{uid} document.
 */
export const signIn = (user = authMock.__user(), userProfile = makeUserProfile()) => {
  authMock.__setUser(user);
  if (user && userProfile) {
    firestoreMock.getDoc.mockResolvedValue(firestoreMock.__doc(user.uid, userProfile));
  }
  return user;
};

/** Signed-out state. */
export const signOut = () => {
  authMock.__setUser(null);
  firestoreMock.getDoc.mockResolvedValue(firestoreMock.__doc('missing', null));
};

/**
 * Render `ui` inside the providers the app actually uses.
 *
 * @param {ReactElement} ui
 * @param {object} options
 * @param {object|null} options.user         - signed-in user (null = signed out)
 * @param {object|null} options.userProfile  - users/{uid} document
 * @param {string}      options.route        - initial URL
 * @param {string}      options.path         - route pattern, when `ui` reads params
 * @param {boolean}     options.withRouter   - wrap in MemoryRouter (default true)
 * @param {boolean}     options.withAuth     - wrap in AuthProvider (default true)
 * @param {boolean}     options.withToast    - wrap in ToastProvider (default true)
 */
export const renderWithProviders = (ui, options = {}) => {
  const {
    user = authMock.__user(),
    userProfile = makeUserProfile(),
    route = '/',
    path,
    withRouter = true,
    withAuth = true,
    withToast = true,
    ...renderOptions
  } = options;

  if (withAuth) {
    if (user) signIn(user, userProfile);
    else signOut();
  }

  const Wrapper = ({ children }) => {
    let tree = children;

    if (path) {
      tree = (
        <Routes>
          <Route path={path} element={tree} />
        </Routes>
      );
    }
    if (withToast) tree = <ToastProvider>{tree}</ToastProvider>;
    if (withAuth) tree = <AuthProvider>{tree}</AuthProvider>;
    if (withRouter) tree = <MemoryRouter initialEntries={[route]}>{tree}</MemoryRouter>;

    return tree;
  };

  return {
    user: userEvent.setup(),
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
};

/**
 * Let pending promises resolve inside `act`, for effects that fetch on mount
 * without rendering anything a `findBy*` query could wait on.
 */
export const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
