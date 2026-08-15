// src/components/MealPlan/BatchCookingTips.jsx
// Meals worth cooking in one session — roadmap 7.3.

import React from 'react';
import { Card } from 'react-bootstrap';
import { Layers } from 'lucide-react';

/**
 * BatchCookingTips
 *
 * @param {array} tips - { key, group, title, detail, entryDates, fromAi }
 */
const BatchCookingTips = ({ tips = [] }) => {
  if (tips.length === 0) return null;

  return (
    <Card className="shadow-sm h-100" style={{ borderRadius: 'var(--mkh-radius-lg)' }}>
      <Card.Body className="p-3">
        <div className="d-flex align-items-center gap-2 mb-2">
          <Layers size={18} />
          <span className="fw-semibold">Cook once, eat twice</span>
        </div>

        <ul className="list-unstyled mb-0 d-flex flex-column gap-3">
          {tips.map((tip, index) => (
            <li key={tip.key ?? tip.group ?? index}>
              <div className="fw-semibold" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
                {tip.title}
              </div>
              <div
                style={{
                  fontSize: 'var(--mkh-font-size-tiny)',
                  color: 'var(--mkh-text-secondary)',
                }}
              >
                {tip.detail}
              </div>
              {tip.entryDates?.length > 0 && (
                <div
                  className="mt-1"
                  style={{ fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-muted)' }}
                >
                  {tip.entryDates.join(' · ')}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card.Body>
    </Card>
  );
};

export default BatchCookingTips;
