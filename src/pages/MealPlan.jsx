// src/pages/MealPlan.jsx
// Meal planning page - placeholder for Phase 7

import React from 'react';
import { Card, Button } from 'react-bootstrap';
import { Calendar, Sparkles } from 'lucide-react';

const MealPlan = () => {
  return (
    <div className="meal-plan-page">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Meal Plan</h1>
        <Button variant="primary" className="d-flex align-items-center gap-2">
          <Sparkles size={18} />
          Generate Plan
        </Button>
      </div>

      <Card>
        <Card.Body className="text-center py-5">
          <Calendar size={64} className="text-muted mb-3 opacity-50" />
          <h4>AI Meal Planning Coming Soon</h4>
          <p className="text-muted mb-0">
            This feature will be implemented in Phase 7 of the roadmap.
          </p>
        </Card.Body>
      </Card>
    </div>
  );
};

export default MealPlan;
