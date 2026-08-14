// src/components/Layout/Sidebar.jsx
// Mobile-responsive sidebar navigation
// Slides in on mobile, fixed on desktop

import React, { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Home,
  Package,
  BookOpen,
  Calendar,
  Truck,
  BarChart3,
  Settings,
  AlertTriangle,
  X,
  ChefHat,
} from 'lucide-react';
import './Sidebar.css';

/**
 * Navigation Items Configuration
 */
const NAV_ITEMS = [
  {
    path: '/dashboard',
    icon: Home,
    label: 'Dashboard',
  },
  {
    path: '/inventory',
    icon: Package,
    label: 'Inventory',
  },
  {
    path: '/recipes',
    icon: BookOpen,
    label: 'Recipes',
  },
  {
    path: '/meal-plan',
    icon: Calendar,
    label: 'Meal Plan',
  },
  {
    path: '/hellofresh',
    icon: Truck,
    label: 'HelloFresh',
  },
  {
    path: '/analytics',
    icon: BarChart3,
    label: 'Analytics',
  },
];

const BOTTOM_NAV_ITEMS = [
  {
    path: '/settings',
    icon: Settings,
    label: 'Settings',
  },
];

/**
 * Sidebar Component
 *
 * Responsive navigation sidebar:
 * - Desktop: Fixed sidebar on the left
 * - Mobile: Slide-in overlay with backdrop
 *
 * @param {boolean} isOpen - Whether sidebar is open (mobile)
 * @param {function} onClose - Callback to close sidebar
 * @param {number} alertCount - Number of active alerts
 */
const Sidebar = ({ isOpen, onClose, alertCount = 0 }) => {
  const location = useLocation();
  const sidebarRef = useRef(null);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    if (isOpen) {
      onClose();
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle click outside to close (mobile)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && sidebarRef.current && !sidebarRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Handle escape key to close (mobile)
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when sidebar is open (mobile)
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className={`sidebar-backdrop ${isOpen ? 'sidebar-backdrop--visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`app-sidebar ${isOpen ? 'app-sidebar--open' : ''}`}
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Mobile Header */}
        <div className="app-sidebar__header d-lg-none">
          <div className="app-sidebar__brand">
            <div className="app-sidebar__logo">
              <ChefHat size={24} strokeWidth={1.5} />
            </div>
            <span className="app-sidebar__name">MyKitchenHub</span>
          </div>
          <button
            type="button"
            className="app-sidebar__close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X size={24} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="app-sidebar__nav">
          <ul className="app-sidebar__list">
            {NAV_ITEMS.map((item) => (
              <li key={item.path} className="app-sidebar__item">
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `app-sidebar__link ${isActive ? 'app-sidebar__link--active' : ''}`
                  }
                >
                  <item.icon size={20} className="app-sidebar__icon" />
                  <span className="app-sidebar__label">{item.label}</span>
                  {item.path === '/dashboard' && alertCount > 0 && (
                    <span className="app-sidebar__badge">{alertCount}</span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>

          {/* Bottom Navigation */}
          <ul className="app-sidebar__list app-sidebar__list--bottom">
            {BOTTOM_NAV_ITEMS.map((item) => (
              <li key={item.path} className="app-sidebar__item">
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `app-sidebar__link ${isActive ? 'app-sidebar__link--active' : ''}`
                  }
                >
                  <item.icon size={20} className="app-sidebar__icon" />
                  <span className="app-sidebar__label">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Alert Banner (if items expiring) */}
        {alertCount > 0 && (
          <div className="app-sidebar__alert">
            <AlertTriangle size={16} />
            <span>
              {alertCount} item{alertCount !== 1 ? 's' : ''} expiring soon
            </span>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
