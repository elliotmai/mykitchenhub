// src/pages/Dashboard.jsx
// Dashboard page - main overview of kitchen status

import React from 'react';
// eslint-disable-next-line
import { Container, Row, Col, Card, Button } from 'react-bootstrap';
import {
  Package,
  BookOpen,
  Calendar,
  AlertTriangle,
  Plus,
  TrendingUp,
  Clock
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Dashboard Page
 * 
 * Main overview showing:
 * - Quick stats (inventory count, recipes, expiring items)
 * - Urgent alerts
 * - This week's meal plan preview
 * - Quick actions
 */
const Dashboard = () => {
  const { userProfile } = useAuth();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 11) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = userProfile?.displayName || 'there';

  return (
    <div className="dashboard-page">
      {/* Welcome Header */}
      <div className="mb-4">
        <h1 className="h3 mb-1">
          {getGreeting()}, {displayName}! 👋
        </h1>
        <p className="text-muted mb-0">
          Here's what's happening in your kitchen today.
        </p>
      </div>

      {/* Quick Stats */}
      <Row className="g-3 mb-4">
        <Col xs={6} lg={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <div className="mb-2">
                <Package size={24} className="text-primary" />
              </div>
              <h3 className="h4 mb-1">--</h3>
              <p className="text-muted small mb-0">Total Items</p>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} lg={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <div className="mb-2">
                <AlertTriangle size={24} className="text-warning" />
              </div>
              <h3 className="h4 mb-1">--</h3>
              <p className="text-muted small mb-0">Expiring Soon</p>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} lg={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <div className="mb-2">
                <BookOpen size={24} className="text-secondary" />
              </div>
              <h3 className="h4 mb-1">--</h3>
              <p className="text-muted small mb-0">Recipes</p>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} lg={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <div className="mb-2">
                <Calendar size={24} className="text-info" />
              </div>
              <h3 className="h4 mb-1">--</h3>
              <p className="text-muted small mb-0">Meals Planned</p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4">
        {/* Urgent Alerts */}
        <Col lg={6}>
          <Card className="h-100">
            <Card.Header className="bg-transparent">
              <h5 className="mb-0">
                <AlertTriangle size={18} className="me-2 text-warning" />
                Urgent Alerts
              </h5>
            </Card.Header>
            <Card.Body>
              <div className="text-center text-muted py-4">
                <Clock size={48} className="mb-3 opacity-50" />
                <p className="mb-0">No urgent alerts right now.</p>
                <p className="small">Items expiring soon will appear here.</p>
              </div>
            </Card.Body>
          </Card>
        </Col>

        {/* Quick Actions */}
        <Col lg={6}>
          <Card className="h-100">
            <Card.Header className="bg-transparent">
              <h5 className="mb-0">
                <TrendingUp size={18} className="me-2" />
                Quick Actions
              </h5>
            </Card.Header>
            <Card.Body>
              <div className="d-grid gap-2">
                <Button
                  as={Link}
                  to="/inventory"
                  variant="outline-primary"
                  className="d-flex align-items-center justify-content-center gap-2"
                >
                  <Plus size={18} />
                  Add Inventory Item
                </Button>
                <Button
                  as={Link}
                  to="/meal-plan"
                  variant="outline-secondary"
                  className="d-flex align-items-center justify-content-center gap-2"
                >
                  <Calendar size={18} />
                  Plan This Week's Meals
                </Button>
                <Button
                  as={Link}
                  to="/recipes"
                  variant="outline-info"
                  className="d-flex align-items-center justify-content-center gap-2"
                >
                  <BookOpen size={18} />
                  Browse Recipes
                </Button>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
