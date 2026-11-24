/* /api/generateMealPlan: a week of meals from the household's kitchen (functions/src/mealPlan). */
import planModule from '../../functions/src/mealPlan/generateMealPlan.js';
import { callable } from '../lib/kitchen.mjs';

const { generatePlanForUser } = planModule;

export default callable(async ({ uid, db, data }) => {
  try {
    return await generatePlanForUser({ uid, db, weekStart: data.weekStart, days: data.days });
  } catch (err) {
    console.error('generateMealPlan failed:', err?.message);
    throw Object.assign(new Error('Could not generate a meal plan.'), { status: 'internal' });
  }
});

export const config = { path: '/api/generateMealPlan' };
