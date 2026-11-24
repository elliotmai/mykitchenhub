/*
 * /api/syncLegacyRecipes: bring Let's Eat's recipes into the recipe library
 * (functions/src/recipes). Let's Eat lives in the same Supabase project now,
 * so its recipes are the household's own letseat.docs, read-only.
 */
import syncModule from '../../functions/src/recipes/syncLegacyRecipes.js';
import { callable, letsEatFor } from '../lib/kitchen.mjs';

const { handleLegacySync } = syncModule;

export default callable(({ uid, db, householdId, data }) =>
  handleLegacySync({ uid, data, db, legacyDb: letsEatFor(householdId) })
);

export const config = { path: '/api/syncLegacyRecipes' };
