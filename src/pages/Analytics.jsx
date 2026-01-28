// src/pages/Analytics.jsx
// Analytics page - placeholder for Phase 8

import React from 'react';
import { Card } from 'react-bootstrap';
import { BarChart3 } from 'lucide-react';

const Analytics = () => {
  return (
    <div className="analytics-page">
      <div className="mb-4">
        <h1 className="h3 mb-0">Analytics</h1>
      </div>

      <Card>
        <Card.Body className="text-center py-5">
          <BarChart3 size={64} className="text-muted mb-3 opacity-50" />
          <h4>Analytics & Insights Coming Soon</h4>
          <p className="text-muted mb-0">
            This feature will be implemented in Phase 8 of the roadmap.
          </p>
        </Card.Body>
      </Card>
    </div>
  );
};

export default Analytics;
