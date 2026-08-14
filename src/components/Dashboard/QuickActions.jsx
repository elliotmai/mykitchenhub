// src/components/Dashboard/QuickActions.jsx
// The four things someone standing in their kitchen actually wants to do next.

import React from 'react';
import { Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { Plus, Calendar, BookOpen, BarChart3, Zap } from 'lucide-react';

// These navigate, so they are links wearing button styling rather than
// react-bootstrap Buttons — <Button as={Link}> stamps role="button" on the
// anchor, which announces "button" to a screen reader for something that
// actually moves you to another page.

/** Order matters: most-used first, because on a phone the last one is a scroll away. */
export const QUICK_ACTIONS = [
  { to: '/inventory', label: 'Add an item', icon: Plus, variant: 'outline-primary' },
  {
    to: '/meal-plan',
    label: "Plan this week's meals",
    icon: Calendar,
    variant: 'outline-secondary',
  },
  { to: '/recipes', label: 'Find a recipe', icon: BookOpen, variant: 'outline-info' },
  { to: '/analytics', label: 'See shopping insights', icon: BarChart3, variant: 'outline-primary' },
];

/** QuickActions — a stack of links, full width so they're thumb-sized on mobile. */
const QuickActions = () => (
  <Card className="h-100 quick-actions">
    <Card.Header className="bg-transparent">
      <h5 className="mb-0 d-flex align-items-center">
        <Zap size={18} className="me-2" aria-hidden="true" />
        Quick Actions
      </h5>
    </Card.Header>
    <Card.Body>
      <div className="d-grid gap-2">
        {QUICK_ACTIONS.map(({ to, label, icon: Icon, variant }) => (
          <Link
            key={to}
            to={to}
            className={`btn btn-${variant} d-flex align-items-center justify-content-center gap-2`}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
    </Card.Body>
  </Card>
);

export default QuickActions;
