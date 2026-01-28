// src/pages/Inventory.jsx
// Inventory management page - placeholder for Phase 3

import React from 'react';
import { Card, Button } from 'react-bootstrap';
import { Package, Plus } from 'lucide-react';

const Inventory = () => {
  return (
    <div className="inventory-page">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Inventory</h1>
        <Button variant="primary" className="d-flex align-items-center gap-2">
          <Plus size={18} />
          Add Item
        </Button>
      </div>

      <Card>
        <Card.Body className="text-center py-5">
          <Package size={64} className="text-muted mb-3 opacity-50" />
          <h4>Inventory Management Coming Soon</h4>
          <p className="text-muted mb-0">
            This feature will be implemented in Phase 3 of the roadmap.
          </p>
        </Card.Body>
      </Card>
    </div>
  );
};

export default Inventory;
