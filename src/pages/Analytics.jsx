// src/pages/Analytics.jsx
// Analytics page - shopping insights built from inventory purchase history.

import React from 'react';
import useShoppingAnalytics from '../hooks/useShoppingAnalytics';
import { ShoppingPatterns } from '../components/Analytics';
import '../components/Analytics/Analytics.css';

/**
 * Analytics Page
 *
 * Shows shopping patterns: what gets bought most often, what it costs, how
 * spending moves month to month, and which store is cheapest.
 */
const Analytics = () => {
  const analytics = useShoppingAnalytics();

  return (
    <div className="analytics-page">
      <div className="mb-4">
        <h1 className="h3 mb-1">Analytics</h1>
        <p className="text-muted mb-0">What you buy, what it costs, and where you buy it.</p>
      </div>

      <ShoppingPatterns analytics={analytics} />
    </div>
  );
};

export default Analytics;
