// src/hooks/useMealPlanWeek.js
// Read-only view of the current week's meal plan, for the dashboard preview.
//
// Phase 7 owns meal planning and everything that *writes* to
// `users/{uid}/mealPlans`. This hook only reads the contract documented in
// firestore/SCHEMA_DOCUMENTATION.md, and treats a missing collection, an empty
// collection and a plan for some other week identically: there is nothing
// planned, show the empty state.

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import { toDate, startOfWeekMonday, isSameWeek } from '../utils/timestamps';

/** Days in the order a week is cooked, matching the schema's `meals[].day`. */
export const DAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DAY_LABELS = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

/** `monday` → `Mon`; anything unrecognised is title-cased as-is. */
export const dayLabel = (day) => {
  if (typeof day !== 'string' || !day) return '';
  const key = day.toLowerCase();
  return DAY_LABELS[key] ?? day.charAt(0).toUpperCase() + day.slice(1);
};

/**
 * Flatten a plan document's `meals` into something a list can render.
 *
 * Deliberately forgiving: a meal only has to name a day and a recipe. Entries
 * missing both are dropped rather than rendered as a blank row.
 */
export const normalizeMeals = (plan) => {
  const meals = Array.isArray(plan?.meals) ? plan.meals : [];

  return meals
    .map((meal, index) => {
      const day = typeof meal?.day === 'string' ? meal.day.toLowerCase() : '';
      const title = meal?.recipeName ?? meal?.name ?? '';
      return {
        key: `${day || 'meal'}-${index}`,
        day,
        dayLabel: dayLabel(day),
        title: typeof title === 'string' ? title.trim() : '',
        servings: typeof meal?.servings === 'number' ? meal.servings : null,
      };
    })
    .filter((meal) => meal.day || meal.title)
    .sort((a, b) => {
      const ai = DAY_ORDER.indexOf(a.day);
      const bi = DAY_ORDER.indexOf(b.day);
      // Unknown days sort last rather than jumping to the front of the week.
      return (ai === -1 ? DAY_ORDER.length : ai) - (bi === -1 ? DAY_ORDER.length : bi);
    });
};

/** "Aug 10 – Aug 16" for the week containing `date`. */
export const weekRangeLabel = (date = new Date()) => {
  const start = startOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
};

/**
 * useMealPlanWeek Hook
 *
 * Usage:
 *   const { plan, meals, mealCount, loading, error, weekLabel } = useMealPlanWeek();
 *
 * `plan` is null whenever the newest plan isn't for the current week, so the
 * preview never shows last month's dinners as if they were tonight's.
 */
const useMealPlanWeek = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setPlans([]);
      setLoading(false);
      return undefined;
    }

    const plansRef = collection(db, 'users', user.uid, 'mealPlans');
    // A handful, newest first — enough to find this week's without reading a year.
    const q = query(plansRef, orderBy('weekOf', 'desc'), limit(5));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPlans(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        // Phase 7 hasn't shipped meal planning yet, or the collection is empty.
        // Either way the dashboard shows "nothing planned", not a broken tile.
        console.error('Error fetching meal plans:', err);
        setPlans([]);
        setError('Failed to load meal plan');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const plan = useMemo(
    () => plans.find((p) => isSameWeek(p.weekOf)) ?? null,
    // `plans` is replaced wholesale by the listener, so identity is enough.
    [plans]
  );

  const meals = useMemo(() => normalizeMeals(plan), [plan]);

  return {
    plan,
    meals,
    mealCount: meals.length,
    weekOf: toDate(plan?.weekOf) ?? startOfWeekMonday(),
    weekLabel: weekRangeLabel(),
    loading,
    error,
  };
};

export default useMealPlanWeek;
