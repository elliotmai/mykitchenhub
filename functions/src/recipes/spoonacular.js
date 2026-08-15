// functions/src/recipes/spoonacular.js
// Looks up cooking instructions for a legacy recipe by name.
//
// One request per recipe: complexSearch with addRecipeInformation returns the
// instructions, image, timings and servings in the same payload, so there is no
// second /information call to pay for.
//
// The HTTP client is injected so tests never touch the network — a test suite
// that costs money is a broken test suite.

const axios = require('axios');

const SPOONACULAR_BASE = 'https://api.spoonacular.com';

/**
 * Estimated USD per search call, used only for the sync's budget guard.
 * Spoonacular bills in quota points rather than dollars; this is a deliberately
 * conservative dollar equivalent so the ceiling trips early rather than late.
 * Override with SPOONACULAR_COST_PER_CALL.
 */
const DEFAULT_COST_PER_CALL = 0.005;

/** Strip the HTML Spoonacular embeds in its plain-text instructions field. */
const stripHtml = (html) =>
  String(html ?? '')
    .replace(/<li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();

/** Turn either shape Spoonacular returns into an array of step strings. */
const parseInstructions = (recipe) => {
  const analyzed = recipe?.analyzedInstructions?.[0]?.steps;
  if (Array.isArray(analyzed) && analyzed.length > 0) {
    return analyzed.map((s) => String(s.step).trim()).filter(Boolean);
  }

  const plain = stripHtml(recipe?.instructions);
  if (!plain) return [];

  return plain
    .split(/\r?\n|(?<=\.)\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
};

/**
 * Find instructions for `name`.
 *
 * @param {string} name
 * @param {object} deps
 * @param {string}   deps.apiKey       - SPOONACULAR_API_KEY
 * @param {object}   deps.http         - axios-like client (injected in tests)
 * @param {number}   deps.costPerCall
 * @returns {Promise<{matched: boolean, cost: number, instructions?: array, ...}>}
 */
const findInstructions = async (
  name,
  { apiKey, http = axios, costPerCall = DEFAULT_COST_PER_CALL } = {}
) => {
  if (!apiKey) return { matched: false, cost: 0, reason: 'no-api-key' };
  if (!String(name ?? '').trim()) return { matched: false, cost: 0, reason: 'no-name' };

  let response;
  try {
    response = await http.get(`${SPOONACULAR_BASE}/recipes/complexSearch`, {
      params: {
        apiKey,
        query: name,
        number: 1,
        addRecipeInformation: true,
        instructionsRequired: true,
      },
      timeout: 15000,
    });
  } catch (err) {
    // A lookup failure is not fatal — the caller falls back to Claude. The
    // request was still made, so the cost counts.
    return { matched: false, cost: costPerCall, reason: 'request-failed', error: err.message };
  }

  const recipe = response?.data?.results?.[0];
  if (!recipe) return { matched: false, cost: costPerCall, reason: 'no-match' };

  const instructions = parseInstructions(recipe);
  if (instructions.length === 0) {
    return { matched: false, cost: costPerCall, reason: 'no-instructions' };
  }

  const readyIn = Number(recipe.readyInMinutes) || null;

  return {
    matched: true,
    cost: costPerCall,
    instructions,
    sourceId: recipe.id ? `spoonacular-${recipe.id}` : null,
    imageUrl: recipe.image || null,
    servings: Number(recipe.servings) > 0 ? Number(recipe.servings) : null,
    // Spoonacular reports total time only; attribute it to cooking so
    // prepTime + cookTime still adds up to something honest.
    cookTime: readyIn,
  };
};

module.exports = {
  SPOONACULAR_BASE,
  DEFAULT_COST_PER_CALL,
  stripHtml,
  parseInstructions,
  findInstructions,
};
