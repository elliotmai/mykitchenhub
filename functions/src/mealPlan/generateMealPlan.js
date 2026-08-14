// functions/src/mealPlan/generateMealPlan.js
// Callable: build a week of meals for the signed-in cook — roadmap 7.2 / 7.3.
//
// This function only *generates*. The client writes the result through the
// normal security rules, so an AI-built plan is validated exactly like one
// scheduled by hand — see src/hooks/useMealPlan.js.

const functions = require('firebase-functions');
const { getFirestore } = require('firebase-admin/firestore');

const { collectPlanContext, isDayKey, startOfWeek, toDayKey } = require('./planContext');
const { buildPrompt } = require('./buildPrompt');
const { parsePlan } = require('./parsePlan');
const { buildFallbackPlan } = require('./fallbackPlan');
const { createClient, requestPlan } = require('./anthropicClient');

const MAX_DAYS = 14;

const NO_KEY_WARNING =
  'The AI planner is not configured, so this week was built from what is expiring in your kitchen.';
const FAILED_WARNING =
  'The AI planner could not be reached, so this week was built from what is expiring in your kitchen.';

/**
 * Generate a plan for one user.
 *
 * @param {object}   options
 * @param {string}   options.uid
 * @param {string}   [options.weekStart] - `YYYY-MM-DD`, defaults to this week
 * @param {number}   [options.days]      - defaults to 7
 * @param {object}   [options.db]        - firestore instance
 * @param {object|null} [options.client] - Anthropic client; null degrades to the
 *                                         local planner. Tests always inject one.
 */
async function generatePlanForUser({ uid, weekStart, days = 7, db, client } = {}) {
  if (!uid) throw new Error('A user id is required to plan meals.');

  const firestore = db || getFirestore();
  const start = isDayKey(weekStart) ? weekStart : toDayKey(startOfWeek());
  const dayCount = Math.min(Math.max(Number(days) || 7, 1), MAX_DAYS);

  const context = await collectPlanContext(firestore, uid, start, dayCount);

  if (!context.openDays.length) {
    return {
      plan: {
        weekStart: start,
        model: null,
        degraded: false,
        entries: [],
        shoppingList: [],
        batchCooking: [],
        notes: '',
      },
      warning: 'Every day this week already has a meal planned.',
    };
  }

  const planner = client === undefined ? createClient() : client;

  const degrade = (warning) => {
    const fallback = buildFallbackPlan(context);
    if (!fallback) return { plan: null, warning };
    return {
      plan: { weekStart: start, model: null, degraded: true, ...fallback },
      warning,
    };
  };

  if (!planner) return degrade(NO_KEY_WARNING);

  let response;
  try {
    response = await requestPlan(planner, buildPrompt(context));
  } catch (err) {
    // Log the shape of the failure, never the payload or the credential.
    console.error('Meal plan generation failed:', err?.code || err?.name || 'error');
    return degrade(FAILED_WARNING);
  }

  const parsed = parsePlan(response.raw, context);
  if (!parsed) {
    console.error('Meal plan generation returned an unusable plan');
    return degrade(FAILED_WARNING);
  }

  return {
    plan: { weekStart: start, model: response.model, degraded: false, ...parsed },
    warning: null,
  };
}

/**
 * Callable entry point. Auth comes from the caller's ID token, so a cook can
 * only ever plan their own week.
 */
const generateMealPlan = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    const uid = context?.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Sign in to generate a meal plan.'
      );
    }

    try {
      return await generatePlanForUser({
        uid,
        weekStart: data?.weekStart,
        days: data?.days,
      });
    } catch (err) {
      console.error('generateMealPlan failed:', err?.message);
      throw new functions.https.HttpsError('internal', 'Could not generate a meal plan.');
    }
  });

module.exports = { generateMealPlan, generatePlanForUser, MAX_DAYS, NO_KEY_WARNING, FAILED_WARNING };
