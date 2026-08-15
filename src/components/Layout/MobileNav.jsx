// src/components/Layout/MobileNav.jsx
// Bottom tab bar for phones — roadmap 9.1 ("improve mobile navigation").
//
// Every page change on a phone used to cost two taps and a wait: open the
// hamburger drawer, wait for it to slide in, tap the destination, wait for it
// to slide out. For an app whose whole job is a quick check on the way past the
// fridge, that is the wrong shape.
//
// The four destinations here are the ones a cook actually moves between —
// what's in the kitchen, what to cook, what's planned, and what is about to go
// off. The drawer stays for everything else (HelloFresh, Analytics, Settings),
// which is what the "More" button opens.
//
// Desktop is untouched: the sidebar is always visible there, so a second copy
// of the same links would be noise. This whole component is display:none above
// the sidebar breakpoint.

import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Package, BookOpen, AlertTriangle, Menu } from 'lucide-react';
import './MobileNav.css';

/**
 * The tabs, in thumb order.
 *
 * Four plus "More" is the ceiling: a fifth tab on a 360px screen leaves each
 * one under the 44px minimum that e2e/mobile.spec.js enforces.
 */
export const MOBILE_NAV_ITEMS = [
  { path: '/dashboard', icon: Home, label: 'Home' },
  { path: '/inventory', icon: Package, label: 'Inventory' },
  { path: '/recipes', icon: BookOpen, label: 'Recipes' },
  { path: '/waste-alerts', icon: AlertTriangle, label: 'Alerts' },
];

/**
 * MobileNav
 *
 * @param {function} onOpenMore - opens the drawer holding the remaining pages
 * @param {number}   alertCount - unread waste alerts, shown on the Alerts tab
 */
const MobileNav = ({ onOpenMore, alertCount = 0 }) => (
  <nav className="mobile-nav" aria-label="Primary">
    <ul className="mobile-nav__list">
      {MOBILE_NAV_ITEMS.map((item) => (
        <li key={item.path} className="mobile-nav__item">
          <NavLink
            to={item.path}
            className={({ isActive }) =>
              `mobile-nav__link ${isActive ? 'mobile-nav__link--active' : ''}`
            }
          >
            <span className="mobile-nav__icon-wrap">
              <item.icon size={22} aria-hidden="true" />
              {item.path === '/waste-alerts' && alertCount > 0 && (
                <span className="mobile-nav__badge" aria-hidden="true">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </span>
            <span className="mobile-nav__label">{item.label}</span>
          </NavLink>
        </li>
      ))}

      <li className="mobile-nav__item">
        <button type="button" className="mobile-nav__link" onClick={onOpenMore}>
          <span className="mobile-nav__icon-wrap">
            <Menu size={22} aria-hidden="true" />
          </span>
          <span className="mobile-nav__label">More</span>
        </button>
      </li>
    </ul>
  </nav>
);

export default MobileNav;
