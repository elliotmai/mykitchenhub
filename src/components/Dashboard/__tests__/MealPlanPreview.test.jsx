// The preview reads the `mealPlanEntries` contract the meal-plan page owns, so
// "there is nothing planned" is the normal case, not the exception.

import React from 'react';
import { renderWithProviders, screen } from '../../../test-utils';
import MealPlanPreview, { buildWeekRows, countPlannedMeals } from '../MealPlanPreview';

const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The seven `weekDays` rows useMealPlan hands out, for a fixed week. */
const weekDays = (todayIndex = -1) =>
  LABELS.map((label, i) => ({
    key: `2026-08-${String(10 + i).padStart(2, '0')}`,
    label,
    isToday: i === todayIndex,
  }));

const entry = (recipeName, overrides = {}) => ({
  id: `entry-${recipeName}`,
  recipeName,
  mealType: 'dinner',
  status: 'planned',
  ...overrides,
});

describe('countPlannedMeals', () => {
  it('adds up every meal across the week', () => {
    expect(
      countPlannedMeals({ '2026-08-10': [entry('A'), entry('B')], '2026-08-12': [entry('C')] })
    ).toBe(3);
  });

  it('is zero for an empty or missing week', () => {
    expect(countPlannedMeals({})).toBe(0);
    expect(countPlannedMeals()).toBe(0);
  });

  it('ignores a day whose value is not a list', () => {
    expect(countPlannedMeals({ '2026-08-10': null, '2026-08-11': 'dinner' })).toBe(0);
  });
});

describe('buildWeekRows', () => {
  it('returns a row per day, in order, even with nothing planned', () => {
    const rows = buildWeekRows(weekDays(), {});

    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.label)).toEqual(LABELS);
    expect(rows.every((r) => r.title === '')).toBe(true);
  });

  it("slots each day's meal against it and leaves the rest empty", () => {
    const days = weekDays();
    const rows = buildWeekRows(days, {
      [days[0].key]: [entry('Salmon')],
      [days[3].key]: [entry('Chili')],
    });

    expect(rows[0].title).toBe('Salmon');
    expect(rows[3].title).toBe('Chili');
    expect(rows[1].title).toBe('');
  });

  it('shows the first meal of a busy day and counts the rest', () => {
    const days = weekDays();
    const rows = buildWeekRows(days, {
      [days[0].key]: [entry('Porridge'), entry('Soup'), entry('Salmon')],
    });

    expect(rows[0].title).toBe('Porridge');
    expect(rows[0].extra).toBe(2);
  });

  it('marks today so the row can be highlighted', () => {
    expect(buildWeekRows(weekDays(2), {})[2].isToday).toBe(true);
  });

  it('survives an entry with no recipe name', () => {
    const days = weekDays();
    const rows = buildWeekRows(days, { [days[0].key]: [entry('   ')] });

    expect(rows[0].title).toBe('');
  });

  it('handles being given nothing at all', () => {
    expect(buildWeekRows()).toEqual([]);
  });
});

describe('MealPlanPreview', () => {
  it('invites planning when the week is empty', () => {
    renderWithProviders(<MealPlanPreview weekDays={weekDays()} entriesByDay={{}} />);

    expect(screen.getByText('No meals planned for this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /plan this week/i })).toHaveAttribute(
      'href',
      '/meal-plan'
    );
  });

  it('says it is loading rather than claiming the week is empty', () => {
    renderWithProviders(<MealPlanPreview weekDays={weekDays()} entriesByDay={{}} loading />);

    expect(screen.getByText("Loading this week's plan…")).toBeInTheDocument();
    expect(screen.queryByText('No meals planned for this week yet.')).not.toBeInTheDocument();
  });

  it('shows every day, so an unplanned Thursday is visible as a gap', () => {
    const days = weekDays();
    renderWithProviders(
      <MealPlanPreview
        weekDays={days}
        entriesByDay={{ [days[0].key]: [entry('Sheet Pan Salmon')] }}
      />
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('Sheet Pan Salmon')).toBeInTheDocument();
    expect(screen.getAllByText('Nothing planned')).toHaveLength(6);
  });

  it('notes the extra meals on a day with more than one', () => {
    const days = weekDays();
    renderWithProviders(
      <MealPlanPreview
        weekDays={days}
        entriesByDay={{ [days[0].key]: [entry('Soup'), entry('Salmon')] }}
      />
    );

    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('shows the week it is describing', () => {
    renderWithProviders(
      <MealPlanPreview weekDays={weekDays()} entriesByDay={{}} weekLabel="Aug 10 – Aug 16" />
    );

    expect(screen.getByText('Aug 10 – Aug 16')).toBeInTheDocument();
  });

  it('links through to the full plan once there is one', () => {
    const days = weekDays();
    renderWithProviders(
      <MealPlanPreview weekDays={days} entriesByDay={{ [days[0].key]: [entry('Salmon')] }} />
    );

    expect(screen.getByRole('link', { name: /open meal plan/i })).toHaveAttribute(
      'href',
      '/meal-plan'
    );
  });
});
