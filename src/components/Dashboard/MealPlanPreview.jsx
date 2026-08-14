// src/components/Dashboard/MealPlanPreview.jsx
// This week's dinners at a glance.
//
// Read-only: planning lives on /meal-plan (Phase 7). All this does is show the
// seven days and what, if anything, is against each of them.

import React from 'react';
import { Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { Calendar, Sparkles } from 'lucide-react';
import { DAY_ORDER, dayLabel } from '../../hooks/useMealPlanWeek';

/**
 * Pair every day of the week with its planned meal, so an unplanned Thursday is
 * visible as a gap rather than silently missing from the list.
 *
 * @param {Array} meals - normalized meals from useMealPlanWeek
 */
export const buildWeekRows = (meals = []) => {
  const byDay = new Map();
  meals.forEach((meal) => {
    if (meal.day && !byDay.has(meal.day)) byDay.set(meal.day, meal);
  });

  return DAY_ORDER.map((day) => ({
    day,
    label: dayLabel(day),
    meal: byDay.get(day) ?? null,
  }));
};

/**
 * MealPlanPreview
 *
 * @param {Array} meals - normalized meals for the current week
 * @param {string} weekLabel - e.g. "Aug 10 – Aug 16"
 * @param {boolean} loading - plan still arriving
 */
const MealPlanPreview = ({ meals = [], weekLabel = '', loading = false }) => {
  const rows = buildWeekRows(meals);
  const planned = meals.length;

  return (
    <Card className="h-100 meal-plan-preview">
      <Card.Header className="bg-transparent d-flex align-items-center justify-content-between">
        <h5 className="mb-0 d-flex align-items-center">
          <Calendar size={18} className="me-2" aria-hidden="true" />
          This Week's Meals
        </h5>
        {weekLabel ? <span className="text-muted small">{weekLabel}</span> : null}
      </Card.Header>

      <Card.Body>
        {loading ? (
          <p className="text-muted mb-0">Loading this week's plan…</p>
        ) : planned === 0 ? (
          <div className="text-center text-muted py-4">
            <Sparkles size={48} className="mb-3 opacity-50" aria-hidden="true" />
            <p className="mb-1">No meals planned for this week yet.</p>
            <p className="small">Plan a week and it will show up right here.</p>
            <Link to="/meal-plan" className="btn btn-outline-secondary btn-sm">
              Plan this week
            </Link>
          </div>
        ) : (
          <>
            <ol className="meal-plan-preview__days">
              {rows.map((row) => (
                <li
                  key={row.day}
                  className={`meal-plan-day${row.meal ? '' : ' meal-plan-day--empty'}`}
                >
                  <span className="meal-plan-day__label">{row.label}</span>
                  <span className="meal-plan-day__meal">
                    {row.meal ? row.meal.title || 'Planned meal' : 'Nothing planned'}
                  </span>
                </li>
              ))}
            </ol>

            <Link to="/meal-plan" className="btn btn-outline-secondary btn-sm">
              Open meal plan
            </Link>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default MealPlanPreview;
