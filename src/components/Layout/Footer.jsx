// src/components/Layout/Footer.jsx
// Simple footer component with version info and links

import React from 'react';
import { Heart } from 'lucide-react';
import { APP_VERSION, ROADMAP_STEP, ROADMAP_STEP_NAME, BUILD_ID } from '../../config/version';
import './Footer.css';

/**
 * Footer Component
 *
 * Simple footer with:
 * - Copyright notice
 * - Version number
 * - Optional links
 */
const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="app-footer__content">
        <p className="app-footer__text">
          Made with <Heart size={14} className="app-footer__heart" /> for better meal planning
        </p>
        <p className="app-footer__copyright">
          © {currentYear} MyKitchenHub •{' '}
          <span
            className="app-footer__version"
            title={`Roadmap step ${ROADMAP_STEP} — ${ROADMAP_STEP_NAME}`}
          >
            v{APP_VERSION}
            {/* The part that actually differs between two builds carrying the
                same roadmap step. Quiet, because it is a diagnostic — but
                present, because "did my update land" has no other answer. */}
            {BUILD_ID && <span className="app-footer__build"> ({BUILD_ID})</span>}
          </span>
        </p>
        <a
          className="app-footer__feedback"
          href="https://ticketbooth.netlify.app/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Report a bug or request a feature
        </a>
      </div>
    </footer>
  );
};

export default Footer;
