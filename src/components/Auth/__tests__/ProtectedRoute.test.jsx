// Route guards decide whether a signed-out visitor can reach kitchen data, so
// each branch (loading / allowed / redirected) is covered explicitly.

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';

import ProtectedRoute, { PublicOnlyRoute } from '../ProtectedRoute';
import { renderWithProviders, authMock } from '../../../test-utils';

const Dashboard = () => <h1>Dashboard</h1>;
const LoginPage = () => <h1>Login</h1>;

const renderGuardedApp = (options) =>
  renderWithProviders(
    <Routes>
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route path="/login" element={<LoginPage />} />
    </Routes>,
    options
  );

describe('ProtectedRoute', () => {
  it('renders the protected page for a signed-in user', async () => {
    renderGuardedApp({ route: '/dashboard', user: authMock.__user() });

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('redirects a signed-out visitor to login', async () => {
    renderGuardedApp({ route: '/dashboard', user: null });

    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('does not leak protected content while auth is still resolving', async () => {
    renderGuardedApp({ route: '/dashboard', user: null });

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
    );
  });
});

describe('PublicOnlyRoute', () => {
  const renderPublicApp = (options) =>
    renderWithProviders(
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>,
      options
    );

  it('shows the login page to a signed-out visitor', async () => {
    renderPublicApp({ route: '/login', user: null });

    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  });

  it('bounces an already signed-in user to the dashboard', async () => {
    renderPublicApp({ route: '/login', user: authMock.__user() });

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
