// functions/src/mealPlan/anthropicClient.js
// The Claude call behind meal plan generation — roadmap 7.2.
//
// The key comes from ANTHROPIC_API_KEY, or from Firebase Functions config as a
// fallback for deployments configured the older way. It is never logged, and a
// missing key is not an error: the caller falls back to a local plan.

const Anthropic = require('@anthropic-ai/sdk');
const functions = require('firebase-functions');

const { PLAN_SCHEMA } = require('./planSchema');

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 16000;

/** The configured API key, or null when the feature should degrade. */
function resolveApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const config = functions.config();
    return config?.anthropic?.key || null;
  } catch (err) {
    // functions.config() throws when nothing is configured (e.g. locally).
    return null;
  }
}

/** An Anthropic client, or null when no credential is available. */
function createClient(apiKey = resolveApiKey()) {
  if (!apiKey) return null;
  const Ctor = Anthropic.Anthropic || Anthropic;
  return new Ctor({ apiKey });
}

/** Concatenate the text blocks of a Messages API response. */
function textOf(response) {
  return (response?.content || [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * Ask Claude for a week of meals.
 *
 * Structured outputs pin the response to PLAN_SCHEMA, so the caller parses
 * validated JSON rather than prose.
 *
 * @param {object} client - an Anthropic client (injected in tests)
 * @param {{system: string, user: string}} prompt
 * @returns {{ raw: string, model: string }}
 */
async function requestPlan(client, prompt) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: prompt.system,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PLAN_SCHEMA },
    },
    messages: [{ role: 'user', content: prompt.user }],
  });

  // A refusal is a successful HTTP response with empty content — reading
  // content[0] without checking would look like a malformed plan.
  if (response?.stop_reason === 'refusal') {
    const error = new Error('The planner declined this request.');
    error.code = 'refusal';
    throw error;
  }

  return { raw: textOf(response), model: response?.model || MODEL };
}

module.exports = { createClient, resolveApiKey, requestPlan, textOf, MODEL, MAX_TOKENS };
