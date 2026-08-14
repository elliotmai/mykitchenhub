// src/components/Layout/Navbar.jsx
// Top navigation bar with user menu and mobile toggle
// Responsive design with dropdown for user actions

import React, { useState } from 'react';
// eslint-disable-next-line
import { Navbar as BSNavbar, Container, Nav, Dropdown, Badge } from 'react-bootstrap';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChefHat,
  Menu,
  Bell,
  User,
  Settings,
  LogOut,
  // eslint-disable-next-line
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import './Navbar.css';
import '../../pwa-safe-area.css';

/**
 * Navbar Component
 *
 * Top navigation bar with:
 * - Logo and app name
 * - Mobile sidebar toggle
 * - Notifications indicator
 * - User menu with profile and logout
 *
 * @param {function} onToggleSidebar - Callback to toggle mobile sidebar
 * @param {number} alertCount - Number of active alerts to display
 */
const Navbar = ({ onToggleSidebar, alertCount = 0 }) => {
  const { user, userProfile, logout } = useAuth();
  const navigate = useNavigate();
  // eslint-disable-next-line
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);

  /**
   * Handle logout
   */
  const handleLogout = async () => {
    const result = await logout();
    if (result.success) {
      navigate('/login');
    }
  };

  /**
   * Get user display name
   */
  const getDisplayName = () => {
    if (userProfile?.displayName) return userProfile.displayName;
    if (user?.displayName) return user.displayName;
    if (user?.email) return user.email.split('@')[0];
    return 'User';
  };

  /**
   * Get user initials for avatar
   */
  const getInitials = () => {
    const name = getDisplayName();
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <BSNavbar className="app-navbar" expand="lg" fixed="top">
      <Container fluid className="app-navbar__container">
        {/* Mobile Menu Toggle */}
        <button
          type="button"
          className="app-navbar__toggle d-lg-none"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <Menu size={24} />
        </button>

        {/* Logo / Brand */}
        <BSNavbar.Brand as={Link} to="/dashboard" className="app-navbar__brand">
          <div className="app-navbar__logo">
            <ChefHat size={24} strokeWidth={1.5} />
          </div>
          <span className="app-navbar__name d-none d-sm-inline">MyKitchenHub</span>
        </BSNavbar.Brand>

        {/* Right Side Items */}
        <div className="app-navbar__right">
          {/* Notifications */}
          <button
            type="button"
            className="app-navbar__icon-btn"
            onClick={() => navigate('/dashboard')}
            aria-label="View notifications"
          >
            <Bell size={20} />
            {alertCount > 0 && (
              <Badge pill bg="danger" className="app-navbar__badge">
                {alertCount > 9 ? '9+' : alertCount}
              </Badge>
            )}
          </button>

          {/* User Menu */}
          <Dropdown show={showDropdown} onToggle={(show) => setShowDropdown(show)} align="end">
            <Dropdown.Toggle as="button" className="app-navbar__user-btn" id="user-dropdown">
              <div className="app-navbar__avatar">{getInitials()}</div>
              <span className="app-navbar__user-name d-none d-md-inline">{getDisplayName()}</span>
            </Dropdown.Toggle>

            <Dropdown.Menu className="app-navbar__dropdown">
              <div className="app-navbar__dropdown-header">
                <div className="app-navbar__dropdown-avatar">{getInitials()}</div>
                <div className="app-navbar__dropdown-info">
                  <div className="app-navbar__dropdown-name">{getDisplayName()}</div>
                  <div className="app-navbar__dropdown-email">{user?.email}</div>
                </div>
              </div>

              <Dropdown.Divider />

              <Dropdown.Item as={Link} to="/settings" className="app-navbar__dropdown-item">
                <User size={16} />
                Profile
              </Dropdown.Item>

              <Dropdown.Item as={Link} to="/settings" className="app-navbar__dropdown-item">
                <Settings size={16} />
                Settings
              </Dropdown.Item>

              <Dropdown.Divider />

              <Dropdown.Item
                onClick={handleLogout}
                className="app-navbar__dropdown-item app-navbar__dropdown-item--danger"
              >
                <LogOut size={16} />
                Sign Out
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </Container>
    </BSNavbar>
  );
};

export default Navbar;
