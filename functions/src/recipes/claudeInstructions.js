// functions/src/recipes/claudeInstructions.js
// Last resort for a legacy recipe with no instructions: ask Claude to write
// them from the recipe's name and ingredient list.
//
// This is the only paid-per-token call in the sync, so it is also where the
// cost tracking is exact — every response reports its own token usage and the
// caller adds that to the running total against the budget ceiling.

const Anthropic = require('@anthropic-ai/sdk');

/** Model used for instruction generation. Override with ANTHROPIC_MODEL. */
const DEFAULT_MODEL = 'claude-opus-5';

/**
 * List price per million tokens, in USD, for DEFAULT_MODEL. Cache reads bill at
 * roughly a tenth of the input rate. Used for the sync's budget guard — if the
 * model is changed, change these too.
 */
const PRICE_PER_MTOK = { input: 5.0, output: 25.0, cacheRead: 0.5 };

/** Structured output shape, so the response never needs coaxing into JSON. */
const INSTRUCTIONS_SCHEMA = {
  type: 'object',
  properties: {
    instructions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ordered cooking steps, one sentence or two per step.',
    },
  },
  required: ['instructions'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'You write clear, practical cooking instructions for a home cook.',
  'Work only from the recipe name and the ingredients given — do not invent ingredients.',
  'Write 3 to 8 numbered steps. Each step is one action, in plain language,',
  'with times and temperatures where they matter.',
].join(' ');

/** Cost in USD for one response, from the token counts it reports. */
const costOfUsage = (usage = {}, prices = PRICE_PER_MTOK) => {
  const input = Number(usage.input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;

  return (
    (input * prices.input + output * prices.output + cacheRead * prices.cacheRead) / 1_000_000
  );
};

/** The prompt for one recipe. */
const buildPrompt = ({ name, ingredients = [] }) => {
  const list = ingredients
    .map((i) => {
      const qty = [i.quantity, i.unit].filter(Boolean).join(' ');
      return qty ? `- ${qty} ${i.name}` : `- ${i.name}`;
    })
    .join('\n');

  return `Recipe: ${name}\n\nIngredients:\n${list || '- (none recorded)'}\n\nWrite the cooking instructions.`;
};

/** Concatenate the text blocks of a response. */
const textOf = (response) =>
  (response?.content ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

/**
 * Generate instructions for one recipe.
 *
 * @param {object} recipe            - { name, ingredients }
 * @param {object} deps
 * @param {string} deps.apiKey       - ANTHROPIC_API_KEY
 * @param {object} deps.client       - an Anthropic client (injected in tests)
 * @param {string} deps.model
 * @returns {Promise<{generated: boolean, cost: number, instructions?: array, reason?: string}>}
 */
const generateInstructions = async (
  recipe,
  { apiKey, client, model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL } = {}
) => {
  const anthropic = client ?? (apiKey ? new Anthropic({ apiKey }) : null);
  if (!anthropic) return { generated: false, cost: 0, reason: 'no-api-key' };
  if (!String(recipe?.name ?? '').trim()) return { generated: false, cost: 0, reason: 'no-name' };

  let response;
  try {
    response = await anthropic.beta.messages.create({
      model,
      max_tokens: 2000,
      // Safety classifiers can decline a request; letting the API retry it on
      // its recommended fallback keeps one odd recipe from stalling a batch.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: INSTRUCTIONS_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(recipe) }],
    });
  } catch (err) {
    return { generated: false, cost: 0, reason: 'request-failed', error: err.message };
  }

  const cost = costOfUsage(response?.usage);

  // A refusal is a successful HTTP response with no usable content.
  if (response?.stop_reason === 'refusal') {
    return { generated: false, cost, reason: 'refused' };
  }
  if (response?.stop_reason === 'max_tokens') {
    return { generated: false, cost, reason: 'truncated' };
  }

  let parsed;
  try {
    parsed = JSON.parse(textOf(response));
  } catch (err) {
    return { generated: false, cost, reason: 'unparseable' };
  }

  const instructions = (Array.isArray(parsed?.instructions) ? parsed.instructions : [])
    .map((step) => String(step).trim())
    .filter(Boolean);

  if (instructions.length === 0) return { generated: false, cost, reason: 'empty' };

  return { generated: true, cost, instructions };
};

module.exports = {
  DEFAULT_MODEL,
  PRICE_PER_MTOK,
  INSTRUCTIONS_SCHEMA,
  SYSTEM_PROMPT,
  costOfUsage,
  buildPrompt,
  textOf,
  generateInstructions,
};
