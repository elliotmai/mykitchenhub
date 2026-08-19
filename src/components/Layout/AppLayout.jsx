// src/components/Layout/AppLayout.jsx
// Main application layout wrapper
// Combines Navbar, Sidebar, Footer with main content area

import React, { useState, useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import useWasteAlerts from '../../hooks/useWasteAlerts';
import useIdleReturn from '../../hooks/useIdleReturn';
import { isKioskDevice } from '../../utils/kioskMode';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
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
 * The alert count is worked out here rather than passed in. App.jsx used to
 * render `<AppLayout alertCount={0} />` — a literal that had been there since
 * the layout was written, so the bell badge and the sidebar banner could never
 * appear however much food was going off (roadmap 9.4). Reading the same hook
 * the waste alerts page reads means the three places that show the number
 * cannot drift apart.
 */
const AppLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { counts } = useWasteAlerts();
  const alertCount = counts.total;
  const navigate = useNavigate();

  // On the fridge tablet only, drift back to the board once everyone has walked
  // away. Someone taps in to add an item, gets called to the hob, and the
  // display everyone relies on is left showing a half-filled form.
  //
  // Read once per render rather than cached: turning the toggle off in Settings
  // should take effect without reloading the tablet.
  const returnToBoard = useCallback(() => navigate('/kiosk'), [navigate]);
  useIdleReturn(returnToBoard, { enabled: isKioskDevice() });

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

      {/* Bottom tab bar — phones only, hidden above the sidebar breakpoint.
          The four pages a cook moves between are one tap away; "More" opens
          the same drawer the hamburger does. */}
      <MobileNav onOpenMore={toggleSidebar} alertCount={alertCount} />

      {/* Accumulating "What's New" popup */}
      <WhatsNew />
    </div>
  );
};

export default AppLayout;
