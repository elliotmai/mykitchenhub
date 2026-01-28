// src/pages/HelloFresh.jsx
// HelloFresh integration page - placeholder for Phase 5

import React from 'react';
import { Card, Button } from 'react-bootstrap';
import { Truck, Camera } from 'lucide-react';

const HelloFresh = () => {
  return (
    <div className="hellofresh-page">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">HelloFresh</h1>
        <Button variant="primary" className="d-flex align-items-center gap-2">
          <Camera size={18} />
          Import Delivery
        </Button>
      </div>

      <Card>
        <Card.Body className="text-center py-5">
          <Truck size={64} className="text-muted mb-3 opacity-50" />
          <h4>HelloFresh Integration Coming Soon</h4>
          <p className="text-muted mb-0">
            This feature will be implemented in Phase 5 of the roadmap.
          </p>
        </Card.Body>
      </Card>
    </div>
  );
};

export default HelloFresh;
