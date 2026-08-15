/**
 * Claude fallback for recipes Spoonacular could not match.
 *
 * The Anthropic client is a fake in every test — no request ever leaves the
 * machine and no tokens are ever billed. What matters here is that the cost
 * reported back is real (it drives the sync's budget ceiling) and that every
 * unusable response is reported rather than written to the database.
 */

const {
  generateInstructions,
  costOfUsage,
  buildPrompt,
  textOf,
  PRICE_PER_MTOK,
  DEFAULT_MODEL,
} = require('../claudeInstructions');

/** A client whose beta.messages.create returns `response`. */
const fakeClient = (response) => ({
  beta: { messages: { create: jest.fn(async () => response) } },
});

const goodResponse = (steps = ['Heat the pan.', 'Cook the chicken.']) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({ instructions: steps }) }],
  usage: { input_tokens: 400, output_tokens: 200 },
});

const RECIPE = {
  name: 'Chicken Stir Fry',
  ingredients: [
    { name: 'chicken breast', quantity: 1, unit: 'lb' },
    { name: 'soy sauce', quantity: 3, unit: 'tbsp' },
  ],
};

describe('costOfUsage', () => {
  it('prices input and output at the published per-million rates', () => {
    const cost = costOfUsage({ input_tokens: 1_000_000, output_tokens: 0 });
    expect(cost).toBeCloseTo(PRICE_PER_MTOK.input, 6);
  });

  it('prices output higher than input', () => {
    expect(PRICE_PER_MTOK.output).toBeGreaterThan(PRICE_PER_MTOK.input);
  });

  it('bills cached input at a fraction of the full rate', () => {
    expect(PRICE_PER_MTOK.cacheRead).toBeLessThan(PRICE_PER_MTOK.input);

    const cost = costOfUsage({ cache_read_input_tokens: 1_000_000 });
    expect(cost).toBeCloseTo(PRICE_PER_MTOK.cacheRead, 6);
  });

  it('costs nothing when a response reported no usage', () => {
    expect(costOfUsage(undefined)).toBe(0);
    expect(costOfUsage({})).toBe(0);
  });
});

describe('buildPrompt', () => {
  it('names the recipe and lists its ingredients with amounts', () => {
    const prompt = buildPrompt(RECIPE);

    expect(prompt).toContain('Chicken Stir Fry');
    expect(prompt).toContain('1 lb chicken breast');
    expect(prompt).toContain('3 tbsp soy sauce');
  });

  it('says so plainly when a recipe has no ingredients recorded', () => {
    expect(buildPrompt({ name: 'Mystery Dish', ingredients: [] })).toContain('none recorded');
  });
});

describe('textOf', () => {
  it('joins the text blocks and ignores everything else', () => {
    expect(
      textOf({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }] })
    ).toBe('{"a":1}');
  });
});

describe('generateInstructions', () => {
  it('returns the generated steps', async () => {
    const client = fakeClient(goodResponse());

    const result = await generateInstructions(RECIPE, { client });

    expect(result.generated).toBe(true);
    expect(result.instructions).toEqual(['Heat the pan.', 'Cook the chicken.']);
  });

  it('reports what the call actually cost', async () => {
    const client = fakeClient(goodResponse());

    const result = await generateInstructions(RECIPE, { client });

    // 400 input @ $5/MTok + 200 output @ $25/MTok
    expect(result.cost).toBeCloseTo(400 * 5e-6 + 200 * 25e-6, 8);
  });

  it('asks the current model for JSON, bounded and at low effort', async () => {
    const client = fakeClient(goodResponse());

    await generateInstructions(RECIPE, { client });

    const [request] = client.beta.messages.create.mock.calls[0];
    expect(request.model).toBe(DEFAULT_MODEL);
    expect(request.max_tokens).toBeGreaterThan(0);
    expect(request.output_config.effort).toBe('low');
    expect(request.output_config.format.type).toBe('json_schema');
  });

  it('does not call the API at all without a key', async () => {
    const result = await generateInstructions(RECIPE, {});

    expect(result).toMatchObject({ generated: false, cost: 0, reason: 'no-api-key' });
  });

  it('refuses to spend a token on a nameless recipe', async () => {
    const client = fakeClient(goodResponse());

    const result = await generateInstructions({ name: '  ' }, { client });

    expect(result).toMatchObject({ generated: false, cost: 0 });
    expect(client.beta.messages.create).not.toHaveBeenCalled();
  });

  it('handles a refusal as a result, not an exception', async () => {
    const client = fakeClient({
      stop_reason: 'refusal',
      content: [],
      usage: { input_tokens: 100, output_tokens: 0 },
    });

    const result = await generateInstructions(RECIPE, { client });

    expect(result).toMatchObject({ generated: false, reason: 'refused' });
    // The declined attempt still gets accounted for.
    expect(result.cost).toBeGreaterThan(0);
  });

  it('reports a truncated response instead of writing half a recipe', async () => {
    const client = fakeClient({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"instructions": ["Step one' }],
      usage: { input_tokens: 100, output_tokens: 2000 },
    });

    const result = await generateInstructions(RECIPE, { client });

    expect(result).toMatchObject({ generated: false, reason: 'truncated' });
  });

  it('reports unparseable output rather than throwing', async () => {
    const client = fakeClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Sure! Here are the steps:' }],
      usage: { input_tokens: 100, output_tokens: 10 },
    });

    const result = await generateInstructions(RECIPE, { client });

    expect(result).toMatchObject({ generated: false, reason: 'unparseable' });
  });

  it('reports an empty step list rather than an empty recipe', async () => {
    const client = fakeClient(goodResponse([]));

    const result = await generateInstructions(RECIPE, { client });

    expect(result).toMatchObject({ generated: false, reason: 'empty' });
  });

  it('drops blank steps from an otherwise usable answer', async () => {
    const client = fakeClient(goodResponse(['Heat the pan.', '   ', 'Serve.']));

    const result = await generateInstructions(RECIPE, { client });

    expect(result.instructions).toEqual(['Heat the pan.', 'Serve.']);
  });

  it('survives a transport failure so one bad recipe cannot end a batch', async () => {
    const client = {
      beta: { messages: { create: jest.fn(async () => { throw new Error('socket hang up'); }) } },
    };

    const result = await generateInstructions(RECIPE, { client });

    expect(result).toMatchObject({ generated: false, cost: 0, reason: 'request-failed' });
  });
});
