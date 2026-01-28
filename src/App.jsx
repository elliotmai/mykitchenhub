// src/App.jsx
// Main application component with routing and authentication
// MyKitchenHub - Recipe & Inventory Management PWA

import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Styles
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/index.css';

// Providers
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider, ErrorBoundary } from './components/Common';

// Layout
import { AppLayout } from './components/Layout';

// Auth Components
import { ProtectedRoute, PublicOnlyRoute } from './components/Auth';

// PWA Components
import InstallPrompt from './components/InstallPrompt';
import UpdateNotification from './components/UpdateNotification';
import OfflineIndicator from './components/OfflineIndicator';

// Service Worker Registration
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

// Pages
import {
  Login,
  Dashboard,
  Inventory,
  Recipes,
  MealPlan,
  HelloFresh,
  Analytics,
  Settings,
} from './pages';

/**
 * App Routes Component
 * 
 * Defines all application routes with authentication handling.
 */
const AppRoutes = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <Login />
          </PublicOnlyRoute>
        }
      />

      {/* Protected Routes with Layout */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout alertCount={0} />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/recipes" element={<Recipes />} />
        <Route path="/meal-plan" element={<MealPlan />} />
        <Route path="/hellofresh" element={<HelloFresh />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Default Redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* 404 - Redirect to Dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
};

/**
 * App Component
 * 
 * Root component wrapped with all necessary providers:
 * - BrowserRouter: Client-side routing
 * - AuthProvider: Authentication state
 * - ToastProvider: Toast notifications
 * - ErrorBoundary: Error handling
 * - PWA Components: Install prompt, offline indicator, update notification
 */
const App = () => {
  // PWA update state
  const [showUpdateNotification, setShowUpdateNotification] = useState(false);
  const [workbox, setWorkbox] = useState(null);

  // Handle service worker update - tell the waiting SW to take over
  const handleUpdate = () => {
    if (workbox) {
      // Send message to service worker to skip waiting
      workbox.messageSkipWaiting();
      setShowUpdateNotification(false);
      // The page will reload automatically when the new SW takes control
      // (handled by the 'controlling' event in serviceWorkerRegistration.js)
    }
  };

  // Register service worker on mount
  useEffect(() => {
    serviceWorkerRegistration.register({
      onUpdate: (wb) => {
        // New content is available - store the workbox instance
        console.log('New content is available; please refresh.');
        setWorkbox(wb);
        setShowUpdateNotification(true);
      },
      onSuccess: () => {
        // Content is cached for offline use
        console.log('Content is cached for offline use.');
      },
    });
  }, []);

  return (
    <ErrorBoundary showDetails={process.env.NODE_ENV === 'development'}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider position="top-end">
            <AppRoutes />

            {/* PWA Components */}
            <InstallPrompt />
            <OfflineIndicator />
            <UpdateNotification
              show={showUpdateNotification}
              onUpdate={handleUpdate}
              onDismiss={() => setShowUpdateNotification(false)}
            />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;