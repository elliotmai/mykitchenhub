// src/App.jsx
// Main application component with routing and authentication
// MyKitchenHub - Recipe & Inventory Management PWA

import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Styles
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/index.css';

// Providers
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider, ErrorBoundary, PageLoader } from './components/Common';

// Layout
import { AppLayout } from './components/Layout';

// Auth Components
import { ProtectedRoute, PublicOnlyRoute } from './components/Auth';

// Route-level code splitting
import { lazyWithRetry } from './utils/lazyWithRetry';

// PWA Components
import InstallPrompt from './components/InstallPrompt';
import UpdateNotification from './components/UpdateNotification';
import { applyUpdate } from './utils/appUpdate';
import OfflineIndicator from './components/OfflineIndicator';

// Service Worker Registration
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

// Pages
//
// Login stays eager: it is what a signed-out visitor sees first, and making the
// very first paint wait on a second network round trip is the one place code
// splitting costs more than it saves.
//
// Imported from its own module rather than from './pages'. That barrel
// re-exports all ten pages statically, so pulling Login through it drags every
// other page into the initial chunk — and the lazy() calls below then resolve
// to modules that are already there, splitting nothing at all.
import Login from './pages/Login';

// Everything behind the sign-in gate is split into its own chunk — roadmap 9.2.
// All eight pages used to land in the initial bundle, so opening the app
// downloaded and parsed the analytics charts, the CSV parser and the HelloFresh
// importer before it could show the dashboard. Nobody visits eight pages in a
// session; most visits are the dashboard and the inventory.
//
// `import()` here rather than in src/pages/index.js on purpose: that barrel is
// what the unit suite imports synchronously, and a lazy barrel would make every
// component test await a chunk that Jest does not split.
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'), 'Dashboard');
const Inventory = lazyWithRetry(() => import('./pages/Inventory'), 'Inventory');
const Recipes = lazyWithRetry(() => import('./pages/Recipes'), 'Recipes');
const MealPlan = lazyWithRetry(() => import('./pages/MealPlan'), 'MealPlan');
const HelloFresh = lazyWithRetry(() => import('./pages/HelloFresh'), 'HelloFresh');
const Analytics = lazyWithRetry(() => import('./pages/Analytics'), 'Analytics');
const Settings = lazyWithRetry(() => import('./pages/Settings'), 'Settings');
const WasteAlerts = lazyWithRetry(() => import('./pages/WasteAlerts'), 'WasteAlerts');
const ShoppingListPage = lazyWithRetry(() => import('./pages/ShoppingList'), 'ShoppingList');
const Kiosk = lazyWithRetry(() => import('./pages/Kiosk'), 'Kiosk');

/**
 * App Routes Component
 *
 * Defines all application routes with authentication handling.
 */
const AppRoutes = () => {
  return (
    // One Suspense boundary around the whole route table rather than one per
    // route: the fallback is the same in every case, and nesting it inside
    // AppLayout would tear down the navbar and sidebar on each first visit to a
    // page — the chrome should stay put while the page itself arrives.
    <Suspense fallback={<PageLoader text="Loading…" />}>
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
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/meal-plan" element={<MealPlan />} />
          <Route path="/shopping-list" element={<ShoppingListPage />} />
          <Route path="/hellofresh" element={<HelloFresh />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/waste-alerts" element={<WasteAlerts />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* The fridge board.
            Signed-in like everything else, but deliberately outside AppLayout:
            it is a wall display, and a navbar and sidebar on a wall display are
            just things to knock. */}
        <Route
          path="/kiosk"
          element={
            <ProtectedRoute>
              <Kiosk />
            </ProtectedRoute>
          }
        />

        {/* Default Redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* 404 - Redirect to Dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
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
  const [updating, setUpdating] = useState(false);
  const [updateStage, setUpdateStage] = useState(null);

  // Apply the waiting update: activate it, clear the stale caches, reload.
  //
  // The card stays up for the whole thing and reports each stage. It used to
  // be hidden on the first line of this function, which meant that if anything
  // downstream stalled — and on a long-lived page it reliably did — the button
  // was indistinguishable from one that did nothing.
  const handleUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    await applyUpdate({ onStage: setUpdateStage });
    // No cleanup after this: applyUpdate always reloads, so this component is
    // on its way out. Leaving the card up means the last thing on screen is
    // "Reloading…" rather than a card that blinks away first.
  };

  // Register service worker on mount
  useEffect(() => {
    // The chunk reload guard is re-armed by lazyWithRetry, on a chunk that
    // actually loads. It used to be cleared here instead — but the app booting
    // does not mean the chunk did, and clearing it on mount turned a
    // permanently missing chunk into an endless reload loop.
    serviceWorkerRegistration.register({
      onUpdate: () => {
        // A new build is installed and waiting to take over.
        console.log('New content is available; please refresh.');
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
              updating={updating}
              stage={updateStage}
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
