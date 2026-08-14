// The preview reads a collection Phase 7 owns, so "there is no plan" is the
// normal case, not the exception.

import React from 'react';
import { renderWithProviders, screen } from '../../../test-utils';
import MealPlanPreview, { buildWeekRows } from '../MealPlanPreview';

const meal = (day, title) => ({ key: `${day}-0`, day, dayLabel: '', title, servings: null });

describe('buildWeekRows', () => {
  it('always returns all seven days, in order', () => {
    const rows = buildWeekRows([]);

    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(rows.every((r) => r.meal === null)).toBe(true);
  });

  it('slots each meal against its day and leaves the rest empty', () => {
    const rows = buildWeekRows([meal('monday', 'Salmon'), meal('thursday', 'Chili')]);

    expect(rows[0].meal.title).toBe('Salmon');
    expect(rows[3].meal.title).toBe('Chili');
    expect(rows[1].meal).toBeNull();
  });

  it('keeps the first meal when a day has two', () => {
    const rows = buildWeekRows([meal('monday', 'Lunch'), meal('monday', 'Dinner')]);

    expect(rows[0].meal.title).toBe('Lunch');
  });

  it('ignores a meal with no day rather than misplacing it', () => {
    const rows = buildWeekRows([meal('', 'Mystery')]);

    expect(rows.every((r) => r.meal === null)).toBe(true);
  });
});

describe('MealPlanPreview', () => {
  it('invites planning when the week is empty', () => {
    renderWithProviders(<MealPlanPreview meals={[]} />);

    expect(screen.getByText('No meals planned for this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /plan this week/i })).toHaveAttribute(
      'href',
      '/meal-plan'
    );
  });

  it('says it is loading rather than claiming the week is empty', () => {
    renderWithProviders(<MealPlanPreview meals={[]} loading />);

    expect(screen.getByText("Loading this week's plan…")).toBeInTheDocument();
    expect(screen.queryByText('No meals planned for this week yet.')).not.toBeInTheDocument();
  });

  it('shows every day, so an unplanned Thursday is visible as a gap', () => {
    renderWithProviders(<MealPlanPreview meals={[meal('monday', 'Sheet Pan Salmon')]} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('Sheet Pan Salmon')).toBeInTheDocument();
    expect(screen.getAllByText('Nothing planned')).toHaveLength(6);
  });

  it('falls back to a generic name for a meal with no recipe title', () => {
    renderWithProviders(<MealPlanPreview meals={[meal('monday', '')]} />);

    expect(screen.getByText('Planned meal')).toBeInTheDocument();
  });

  it('shows the week it is describing', () => {
    renderWithProviders(<MealPlanPreview meals={[]} weekLabel="Aug 10 – Aug 16" />);

    expect(screen.getByText('Aug 10 – Aug 16')).toBeInTheDocument();
  });

  it('links through to the full plan once there is one', () => {
    renderWithProviders(<MealPlanPreview meals={[meal('monday', 'Salmon')]} />);

    expect(screen.getByRole('link', { name: /open meal plan/i })).toHaveAttribute(
      'href',
      '/meal-plan'
    );
  });
});
