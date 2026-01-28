// src/App.jsx
// Main application component with routing and authentication
// MyKitchenHub - Recipe & Inventory Management PWA

import React from 'react';
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
 */
const App = () => {
  return (
    <ErrorBoundary showDetails={process.env.NODE_ENV === 'development'}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider position="top-end">
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
