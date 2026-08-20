// src/components/MealPlan/MealPlanView.jsx
// The 7-day meal plan board — roadmap 7.1, with AI generation (7.2) and
// batch cooking tips (7.3) alongside it.

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Col, Row, Spinner } from 'react-bootstrap';
import { CalendarDays, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

import useMealPlan, { fromDayKey } from '../../hooks/useMealPlan';
import useShoppingList, { findDuplicateNames } from '../../hooks/useShoppingList';
import { useShoppingListActions } from './useShoppingListActions';
import { useToast } from '../Common';
import { PageLoader } from '../Common/LoadingSpinner';
import DayCard from './DayCard';
import ScheduleMealModal from './ScheduleMealModal';
import ShoppingList from './ShoppingList';
import BatchCookingTips from './BatchCookingTips';

/** "11 – 17 Aug" for the week header. */
export const weekRangeLabel = (weekStart) => {
  const start = fromDayKey(weekStart);
  const end = fromDayKey(weekStart);
  end.setDate(end.getDate() + 6);

  const month = (date) => date.toLocaleDateString(undefined, { month: 'short' });
  const sameMonth = start.getMonth() === end.getMonth();

  return sameMonth
    ? `${start.getDate()} – ${end.getDate()} ${month(end)}`
    : `${start.getDate()} ${month(start)} – ${end.getDate()} ${month(end)}`;
};

const MealPlanView = () => {
  const {
    weekStart,
    weekDays,
    entriesByDay,
    weekEntries,
    plan,
    shoppingList,
    batchTips,
    loading,
    error,
    generating,
    scheduleMeal,
    rescheduleMeal,
    removeMeal,
    markCooked,
    generatePlan,
    goToWeek,
    goToThisWeek,
  } = useMealPlan();

  // The manual half of the shopping list. Its own collection and its own hook:
  // the derived half is a function of this week's meals, and "buy batteries" is
  // not, so it does not belong to a week at all.
  // Read here, written through the shared actions hook — the same wiring the
  // standalone Shopping List page uses, so the two cannot drift.
  const { items: manualItems } = useShoppingList();
  const shoppingActions = useShoppingListActions();

  const { showSuccess, showError, showInfo } = useToast();

  const [addDay, setAddDay] = useState(null);
  const [busyEntryId, setBusyEntryId] = useState(null);
  const [notice, setNotice] = useState(null);

  // Which typed items the week's meals also ask for. Not merged — see
  // findDuplicateNames and SCHEMA_DOCUMENTATION.md §8.
  const duplicateNames = useMemo(
    () => findDuplicateNames(manualItems, shoppingList),
    [manualItems, shoppingList]
  );

  const handleCook = useCallback(
    async (entry) => {
      // Only this meal's button waits — a slow write shouldn't freeze the
      // whole week.
      setBusyEntryId(entry.id);
      const result = await markCooked(entry);
      setBusyEntryId(null);

      if (!result.success) {
        showError(result.error || 'Could not mark that meal as cooked.');
        return;
      }

      if (result.alreadyCooked) {
        showInfo(`${entry.recipeName} was already logged as cooked.`);
        return;
      }

      const used = result.decremented || [];
      showSuccess(
        used.length
          ? `${entry.recipeName} cooked — took ${used.map((i) => i.name).join(', ')} out of your kitchen.`
          : `${entry.recipeName} cooked.`
      );
      if (result.inventoryError) showError(result.inventoryError);
    },
    [markCooked, showError, showSuccess, showInfo]
  );

  const handleRemove = useCallback(
    async (entry) => {
      const result = await removeMeal(entry.id);
      if (result.success) showInfo(`${entry.recipeName} removed from the plan.`);
      else showError(result.error || 'Could not remove that meal.');
    },
    [removeMeal, showError, showInfo]
  );

  /**
   * Move a meal to another day.
   *
   * Both paths to rescheduling land here: dropping a card onto a day, and the
   * "Move to" select beside each meal — which is how this works with a keyboard
   * or on a phone, where HTML5 drag events never fire.
   */
  const moveEntryTo = useCallback(
    async (entryId, dayKey) => {
      const entry = weekEntries.find((candidate) => candidate.id === entryId);
      // Dropping a meal back on the day it already occupies is a no-op, not a
      // write — and an id from outside the board is not ours to move.
      if (!entry || !dayKey || entry.date === dayKey) return;

      const result = await rescheduleMeal(entryId, dayKey);
      if (!result.success) showError(result.error || 'Could not move that meal.');
    },
    [weekEntries, rescheduleMeal, showError]
  );

  const handleMove = useCallback((entry, dayKey) => moveEntryTo(entry.id, dayKey), [moveEntryTo]);

  const handleGenerate = useCallback(async () => {
    setNotice(null);
    const result = await generatePlan();

    if (!result.success) {
      showError(result.error || 'Could not build a plan right now.');
      return;
    }

    if (result.degraded || result.warning) {
      setNotice(
        result.warning ||
          'Built this plan from what is in your kitchen — the AI planner is unavailable right now.'
      );
    }
    showSuccess('Your week is planned.');
  }, [generatePlan, showError, showSuccess]);

  if (loading) return <PageLoader message="Loading your meal plan…" />;

  const hasPlannedMeals = weekEntries.length > 0;

  return (
    <div className="meal-plan-page">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <CalendarDays size={22} />
          <h1 className="h4 mb-0">Meal Plan</h1>
          <span className="text-muted" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
            {weekRangeLabel(weekStart)}
          </span>
        </div>

        <div className="d-flex align-items-center gap-2">
          <Button size="sm" variant="light" aria-label="Previous week" onClick={() => goToWeek(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button size="sm" variant="light" onClick={goToThisWeek}>
            This week
          </Button>
          <Button size="sm" variant="light" aria-label="Next week" onClick={() => goToWeek(1)}>
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="primary"
            className="d-flex align-items-center gap-2"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? <Spinner animation="border" size="sm" /> : <Sparkles size={18} />}
            {generating ? 'Planning…' : plan ? 'Regenerate plan' : 'Generate plan'}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      )}

      {notice && (
        <Alert variant="warning" dismissible onClose={() => setNotice(null)} className="mb-3">
          {notice}
        </Alert>
      )}

      <Row className="g-3">
        <Col xs={12} lg={9}>
          <Row className="g-2">
            {weekDays.map((day) => (
              <Col key={day.key} xs={12} sm={6} md={4} xl>
                <DayCard
                  day={day}
                  days={weekDays}
                  entries={entriesByDay[day.key] || []}
                  onAdd={setAddDay}
                  onCook={handleCook}
                  onRemove={handleRemove}
                  onMove={handleMove}
                  onDropMeal={moveEntryTo}
                  busyEntryId={busyEntryId}
                />
              </Col>
            ))}
          </Row>

          {!hasPlannedMeals && (
            <p className="text-muted mt-3 mb-0" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
              Nothing on the calendar yet. Add a meal to any day, or let the planner build the week
              around what is about to go off in your fridge.
            </p>
          )}
        </Col>

        <Col xs={12} lg={3}>
          <div className="d-flex flex-column gap-3">
            <ShoppingList
              items={shoppingList}
              manualItems={manualItems}
              duplicateNames={duplicateNames}
              {...shoppingActions}
            />
            <BatchCookingTips tips={batchTips} />
          </div>
        </Col>
      </Row>

      <ScheduleMealModal
        show={Boolean(addDay)}
        onHide={() => setAddDay(null)}
        onSave={scheduleMeal}
        date={addDay}
        days={weekDays}
      />
    </div>
  );
};

export default MealPlanView;
