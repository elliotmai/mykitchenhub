// src/components/Dashboard/MealPlanPreview.jsx
// This week's dinners at a glance.
//
// Read-only. Planning itself lives on /meal-plan, and the data comes from the
// `mealPlanEntries` contract that page owns (firestore/SCHEMA_DOCUMENTATION.md)
// — one document per scheduled meal, keyed on a `YYYY-MM-DD` day. All this does
// is show the seven days and what, if anything, is against each of them.

import React from 'react';
import { Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { Calendar, Sparkles } from 'lucide-react';

/**
 * One row per day of the week, with the meals scheduled on it.
 *
 * Every day is present whether or not anything is planned, so an empty
 * Thursday reads as a gap rather than being missing from the list.
 *
 * @param {Array} weekDays - `{ key, label, isToday }` rows from useMealPlan
 * @param {object} entriesByDay - day key → scheduled entries
 */
export const buildWeekRows = (weekDays = [], entriesByDay = {}) =>
  weekDays.map((day) => {
    const entries = Array.isArray(entriesByDay?.[day.key]) ? entriesByDay[day.key] : [];
    return {
      key: day.key,
      label: day.label,
      isToday: Boolean(day.isToday),
      // Every meal on the day, not just the first: a day with lunch and dinner
      // on it should say so rather than quietly hiding one behind a counter.
      meals: entries
        .map((entry, index) => ({
          key: entry?.id ?? `${day.key}-${index}`,
          title: (typeof entry?.recipeName === 'string' ? entry.recipeName : '').trim(),
        }))
        .filter((meal) => meal.title),
    };
  });

/** How many meals are scheduled across the whole week. */
export const countPlannedMeals = (entriesByDay = {}) =>
  Object.values(entriesByDay ?? {}).reduce(
    (total, entries) => total + (Array.isArray(entries) ? entries.length : 0),
    0
  );

/**
 * MealPlanPreview
 *
 * @param {Array} weekDays - the seven days of the current week
 * @param {object} entriesByDay - day key → scheduled entries
 * @param {string} weekLabel - e.g. "Aug 10 – Aug 16"
 * @param {boolean} loading - plan still arriving
 */
const MealPlanPreview = ({ weekDays = [], entriesByDay = {}, weekLabel = '', loading = false }) => {
  const rows = buildWeekRows(weekDays, entriesByDay);
  const planned = countPlannedMeals(entriesByDay);

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
                  key={row.key}
                  className={[
                    'meal-plan-day',
                    row.meals.length ? '' : 'meal-plan-day--empty',
                    row.isToday ? 'meal-plan-day--today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="meal-plan-day__label">{row.label}</span>
                  {row.meals.length === 0 ? (
                    <span className="meal-plan-day__meal">Nothing planned</span>
                  ) : (
                    <span className="meal-plan-day__meals">
                      {row.meals.map((meal) => (
                        <span key={meal.key} className="meal-plan-day__meal">
                          {meal.title}
                        </span>
                      ))}
                    </span>
                  )}
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
