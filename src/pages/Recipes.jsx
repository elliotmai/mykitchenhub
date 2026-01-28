// src/pages/Recipes.jsx
// Recipe management page - placeholder for Phase 4

import React from 'react';
import { Card, Button } from 'react-bootstrap';
import { BookOpen, Plus } from 'lucide-react';

const Recipes = () => {
  return (
    <div className="recipes-page">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Recipes</h1>
        <Button variant="primary" className="d-flex align-items-center gap-2">
          <Plus size={18} />
          Add Recipe
        </Button>
      </div>

      <Card>
        <Card.Body className="text-center py-5">
          <BookOpen size={64} className="text-muted mb-3 opacity-50" />
          <h4>Recipe Management Coming Soon</h4>
          <p className="text-muted mb-0">
            This feature will be implemented in Phase 4 of the roadmap.
          </p>
        </Card.Body>
      </Card>
    </div>
  );
};

export default Recipes;
