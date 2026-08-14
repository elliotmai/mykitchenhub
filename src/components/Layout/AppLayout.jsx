// src/components/Layout/AppLayout.jsx
// Main application layout wrapper
// Combines Navbar, Sidebar, Footer with main content area

import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import Footer from './Footer';
import { WhatsNew } from '../Common';
import './AppLayout.css';

/**
 * AppLayout Component
 *
 * Main layout wrapper for authenticated pages.
 * Provides:
 * - Fixed navbar at top
 * - Fixed sidebar on left (desktop) / slide-in (mobile)
 * - Scrollable main content area
 * - Footer at bottom of content
 *
 * @param {number} alertCount - Number of alerts to show in nav
 */
const AppLayout = ({ alertCount = 0 }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="app-layout">
      {/* Top Navigation */}
      <Navbar onToggleSidebar={toggleSidebar} alertCount={alertCount} />

      {/* Sidebar Navigation */}
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} alertCount={alertCount} />

      {/* Main Content Area */}
      <main className="app-layout__main">
        <div className="app-layout__content">
          <Outlet />
        </div>
        <Footer />
      </main>

      {/* Accumulating "What's New" popup */}
      <WhatsNew />
    </div>
  );
};

export default AppLayout;
