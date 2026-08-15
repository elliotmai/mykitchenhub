// src/pages/Dashboard.jsx
// Dashboard page - main overview of kitchen status
//
// Every number here is read live from Firestore. The collections it reads are
// owned by other roadmap phases, so each one is treated as optional: an empty
// or missing collection renders an empty state, never an error and never a
// blank tile.

import React from 'react';
import { Row, Col, Alert } from 'react-bootstrap';
import { Package, BookOpen, Calendar, AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import useInventory, { isExpiringWithin } from '../hooks/useInventory';
import useRecipeCount from '../hooks/useRecipeCount';
import useMealPlan, { fromDayKey, shiftDayKey } from '../hooks/useMealPlan';
import {
  StatCard,
  UrgentAlerts,
  MealPlanPreview,
  QuickActions,
  countPlannedMeals,
} from '../components/Dashboard';
import '../components/Dashboard/Dashboard.css';

/** "Aug 10 – Aug 16" for the week starting at a `YYYY-MM-DD` key. */
export const weekRangeLabel = (weekStart) => {
  if (!weekStart) return '';
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(fromDayKey(weekStart))} – ${fmt(fromDayKey(shiftDayKey(weekStart, 6)))}`;
};

/**
 * Items in the five-day window the inventory page colour-codes as at-risk.
 *
 * Shares `isExpiringWithin` with the waste-alerts page so the dashboard tile
 * and that page can never disagree about the same kitchen — the two used to
 * define the window separately, one by status name and one by day count.
 */
export const EXPIRING_WINDOW_DAYS = 5;

export const countExpiringSoon = (items = []) =>
  items.filter((item) => isExpiringWithin(item, EXPIRING_WINDOW_DAYS)).length;

/**
 * Dashboard Page
 *
 * Main overview showing:
 * - Quick stats (inventory count, recipes, expiring items, meals planned)
 * - Urgent alerts
 * - This week's meal plan preview
 * - Quick actions
 */
const Dashboard = () => {
  const { userProfile } = useAuth();
  const { items, loading: itemsLoading, error: itemsError } = useInventory();
  const { count: recipeCount, loading: recipesLoading } = useRecipeCount();
  const { weekStart, weekDays, entriesByDay, loading: planLoading } = useMealPlan();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = userProfile?.displayName || 'there';
  const expiringSoon = countExpiringSoon(items);
  const mealCount = countPlannedMeals(entriesByDay);
  const weekLabel = weekRangeLabel(weekStart);

  return (
    <div className="dashboard-page">
      {/* Welcome Header */}
      <div className="mb-4">
        <h1 className="h3 dashboard-page__greeting">
          {getGreeting()}, {displayName}! 👋
        </h1>
        <p className="text-muted mb-0">Here's what's happening in your kitchen today.</p>
      </div>

      {itemsError ? (
        <Alert variant="warning" className="mb-4">
          {itemsError}. The numbers below may be out of date.
        </Alert>
      ) : null}

      {/* Quick Stats */}
      <Row className="g-3 mb-4">
        <Col xs={6} lg={3}>
          <StatCard
            label="Total Items"
            value={items.length}
            icon={Package}
            to="/inventory"
            loading={itemsLoading}
            hint="in your kitchen"
          />
        </Col>
        <Col xs={6} lg={3}>
          <StatCard
            label="Expiring Soon"
            value={expiringSoon}
            icon={AlertTriangle}
            tone={expiringSoon > 0 ? 'warning' : 'default'}
            to="/inventory"
            loading={itemsLoading}
            hint="within 5 days"
          />
        </Col>
        <Col xs={6} lg={3}>
          <StatCard
            label="Recipes"
            value={recipeCount}
            icon={BookOpen}
            tone="success"
            to="/recipes"
            loading={recipesLoading}
            hint="ready to cook"
          />
        </Col>
        <Col xs={6} lg={3}>
          <StatCard
            label="Meals Planned"
            value={mealCount}
            icon={Calendar}
            to="/meal-plan"
            loading={planLoading}
            hint="this week"
          />
        </Col>
      </Row>

      <Row className="g-4">
        <Col lg={6}>
          <UrgentAlerts items={items} loading={itemsLoading} />
        </Col>

        <Col lg={6}>
          <MealPlanPreview
            weekDays={weekDays}
            entriesByDay={entriesByDay}
            weekLabel={weekLabel}
            loading={planLoading}
          />
        </Col>

        <Col lg={6}>
          <QuickActions />
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
