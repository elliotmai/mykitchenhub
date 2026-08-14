// src/components/Auth/ProtectedRoute.jsx
// Route wrapper that requires authentication
// Redirects unauthenticated users to the login page

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { PageLoader } from '../Common';

/**
 * ProtectedRoute Component
 *
 * Wraps routes that require authentication.
 * Redirects to login if user is not authenticated.
 * Shows loading state while checking auth status.
 *
 * Usage:
 * <Route path="/dashboard" element={
 *   <ProtectedRoute>
 *     <Dashboard />
 *   </ProtectedRoute>
 * } />
 *
 * @param {ReactNode} children - The protected content to render
 * @param {string} redirectTo - Path to redirect if not authenticated (default: '/login')
 */
const ProtectedRoute = ({ children, redirectTo = '/login' }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // Show loading state while checking authentication
  if (loading) {
    return <PageLoader message="Loading..." />;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    // Pass the current location so we can redirect back after login
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  // Render protected content
  return children;
};

/**
 * PublicOnlyRoute Component
 *
 * Wraps routes that should only be accessible to unauthenticated users.
 * Redirects to dashboard if user is already authenticated.
 *
 * Usage:
 * <Route path="/login" element={
 *   <PublicOnlyRoute>
 *     <Login />
 *   </PublicOnlyRoute>
 * } />
 */
export const PublicOnlyRoute = ({ children, redirectTo = '/dashboard' }) => {
  const { isAuthenticated, loading } = useAuth();

  // Show loading state while checking authentication
  if (loading) {
    return <PageLoader message="Loading..." />;
  }

  // Redirect to dashboard if already authenticated
  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  // Render public content
  return children;
};

export default ProtectedRoute;
