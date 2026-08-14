import React from 'react';
import { Loader2 } from 'lucide-react';
import './LoadingSpinner.css';

/**
 * LoadingSpinner Component
 *
 * A versatile loading indicator with multiple size and style options.
 *
 * @param {string} size - 'sm' | 'md' | 'lg' | 'xl' (default: 'md')
 * @param {string} variant - 'primary' | 'secondary' | 'light' | 'dark' (default: 'primary')
 * @param {string} text - Optional loading text to display
 * @param {boolean} overlay - If true, displays as a full-screen overlay
 * @param {boolean} inline - If true, displays inline with content
 * @param {string} className - Additional CSS classes
 */
const LoadingSpinner = ({
  size = 'md',
  variant = 'primary',
  text = '',
  overlay = false,
  inline = false,
  className = '',
}) => {
  const sizeMap = {
    sm: 16,
    md: 24,
    lg: 36,
    xl: 48,
  };

  const spinnerSize = sizeMap[size] || sizeMap.md;

  const spinnerContent = (
    <div
      className={`loading-spinner loading-spinner--${size} loading-spinner--${variant} ${inline ? 'loading-spinner--inline' : ''} ${className}`}
    >
      <Loader2 size={spinnerSize} className="loading-spinner__icon" aria-hidden="true" />
      {text && <span className="loading-spinner__text">{text}</span>}
    </div>
  );

  if (overlay) {
    return (
      <div className="loading-spinner__overlay" role="status" aria-live="polite">
        <div className="loading-spinner__overlay-content">{spinnerContent}</div>
        <span className="visually-hidden">Loading{text ? `: ${text}` : '...'}</span>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite">
      {spinnerContent}
      <span className="visually-hidden">Loading{text ? `: ${text}` : '...'}</span>
    </div>
  );
};

/**
 * PageLoader Component
 *
 * A centered full-page loading state for initial page loads.
 */
export const PageLoader = ({ text = 'Loading...' }) => (
  <div className="page-loader">
    <LoadingSpinner size="xl" variant="primary" text={text} />
  </div>
);

/**
 * ButtonLoader Component
 *
 * A small inline loader for button states.
 */
export const ButtonLoader = ({ className = '' }) => (
  <Loader2
    size={16}
    className={`loading-spinner__icon loading-spinner__button ${className}`}
    aria-hidden="true"
  />
);

/**
 * CardLoader Component
 *
 * A skeleton loader for card content.
 */
export const CardLoader = ({ lines = 3 }) => (
  <div className="card-loader" aria-label="Loading content">
    <div className="card-loader__header skeleton" />
    {Array.from({ length: lines }).map((_, index) => (
      <div
        key={index}
        className="card-loader__line skeleton"
        style={{ width: `${Math.random() * 30 + 70}%` }}
      />
    ))}
  </div>
);

export default LoadingSpinner;
