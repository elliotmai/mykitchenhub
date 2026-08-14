/**
 * Claude Vision, with the Anthropic client replaced by a recording fake.
 *
 * No test here may reach api.anthropic.com — a Vision call costs real money, so
 * every case injects `createClient` and asserts on what *would* have been sent.
 */

const {
  MAX_IMAGE_BYTES,
  MODEL,
  MissingApiKeyError,
  RECIPE_OUTPUT_SCHEMA,
  UnreadableImageError,
  VisionRequestError,
  base64ByteLength,
  extractRecipeFromImage,
  getApiKey,
  isVisionConfigured,
  prepareImage,
  readStructuredOutput,
  splitDataUrl,
} = require('../claudeVision');

// A payload big enough to clear the "too small to read" floor.
const validBase64 = 'A'.repeat(4000);

const transcription = {
  readable: true,
  name: 'Sweet Chili Chicken',
  servings: 2,
  prepTime: 10,
  cookTime: 25,
  difficulty: 'medium',
  tags: ['chicken'],
  ingredients: [{ name: 'Chicken Breast', quantity: 2, unit: 'unit' }],
  instructions: ['Roast the chicken.'],
  warnings: [],
};

/** An Anthropic-client-alike that records the request and replays a response. */
const fakeClient = (response) => {
  const create = jest.fn(async () => response);
  return { client: { messages: { create } }, create };
};

const jsonResponse = (payload) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

let originalKey;

beforeEach(() => {
  originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-credential';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  jest.restoreAllMocks();
});

describe('credential handling', () => {
  it('reads the key from the environment', () => {
    expect(getApiKey()).toBe('test-key-not-a-real-credential');
    expect(isVisionConfigured()).toBe(true);
  });

  it('falls back to Firebase Functions config', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getApiKey({ anthropic: { key: 'from-config' } })).toBe('from-config');
  });

  it('treats a blank key as absent', () => {
    process.env.ANTHROPIC_API_KEY = '   ';
    expect(getApiKey()).toBeNull();
    expect(isVisionConfigured()).toBe(false);
  });

  it('degrades gracefully instead of crashing when no key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(isVisionConfigured({})).toBe(false);
    await expect(
      extractRecipeFromImage({ image: validBase64, functionsConfig: {} })
    ).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it('never puts the key in the error it throws', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const err = await extractRecipeFromImage({ image: validBase64, functionsConfig: {} }).catch(
      (e) => e
    );
    expect(err.message).not.toMatch(/key/i);
    expect(err.code).toBe('vision-not-configured');
  });
});

describe('splitDataUrl', () => {
  it('unwraps the data: URL a browser FileReader produces', () => {
    expect(splitDataUrl('data:image/png;base64,AAAA')).toEqual({
      data: 'AAAA',
      mediaType: 'image/png',
    });
  });

  it('passes bare base64 through untouched', () => {
    expect(splitDataUrl('AAAA')).toEqual({ data: 'AAAA', mediaType: null });
  });
});

describe('base64ByteLength', () => {
  it('estimates the decoded size without allocating', () => {
    expect(base64ByteLength('AAAA')).toBe(3);
    expect(base64ByteLength('AAA=')).toBe(2);
  });
});

describe('prepareImage', () => {
  it('accepts a JPEG data URL', () => {
    expect(prepareImage(`data:image/jpeg;base64,${validBase64}`)).toEqual({
      data: validBase64,
      mediaType: 'image/jpeg',
    });
  });

  it('defaults bare base64 to JPEG', () => {
    expect(prepareImage(validBase64).mediaType).toBe('image/jpeg');
  });

  it('lets the data URL win over a mismatched declared type', () => {
    expect(prepareImage(`data:image/png;base64,${validBase64}`, 'image/jpeg').mediaType).toBe(
      'image/png'
    );
  });

  it.each([[''], [null], [undefined]])('rejects missing image data (%p)', (value) => {
    expect(() => prepareImage(value)).toThrow(UnreadableImageError);
  });

  it('rejects a payload that is not base64', () => {
    expect(() => prepareImage('not base64!!! <>')).toThrow(/could not be decoded/i);
  });

  it('rejects a file type the API cannot read', () => {
    expect(() => prepareImage(`data:image/tiff;base64,${validBase64}`)).toThrow(/JPEG, PNG/i);
  });

  it('rejects a photo too large to send', () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1024) * (4 / 3)));
    expect(() => prepareImage(oversized)).toThrow(/too large/i);
  });

  it('rejects a thumbnail nothing could be read from', () => {
    expect(() => prepareImage('AAAA')).toThrow(/too small/i);
  });
});

describe('readStructuredOutput', () => {
  it('parses the JSON the structured-output format guarantees', () => {
    expect(readStructuredOutput(jsonResponse(transcription))).toEqual(transcription);
  });

  it('reports a refusal rather than returning nothing', () => {
    expect(() => readStructuredOutput({ stop_reason: 'refusal', content: [] })).toThrow(
      /declined/i
    );
  });

  it('explains a truncated transcription instead of half-saving it', () => {
    expect(() => readStructuredOutput({ stop_reason: 'max_tokens', content: [] })).toThrow(
      /one side at a time/i
    );
  });

  it('rejects an empty response', () => {
    expect(() => readStructuredOutput({ stop_reason: 'end_turn', content: [] })).toThrow(
      VisionRequestError
    );
  });

  it('rejects unparseable text', () => {
    expect(() =>
      readStructuredOutput({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{oops' }] })
    ).toThrow(/could not be read/i);
  });
});

describe('extractRecipeFromImage', () => {
  it('returns the transcription for a readable card', async () => {
    const { client } = fakeClient(jsonResponse(transcription));

    await expect(
      extractRecipeFromImage({ image: validBase64, createClient: () => client })
    ).resolves.toEqual(transcription);
  });

  it('sends the image as a base64 block on the current model', async () => {
    const { client, create } = fakeClient(jsonResponse(transcription));

    await extractRecipeFromImage({
      image: `data:image/png;base64,${validBase64}`,
      createClient: () => client,
    });

    const [request] = create.mock.calls[0];
    expect(request.model).toBe(MODEL);
    expect(request.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: validBase64 },
    });
  });

  it('constrains the answer to the recipe schema so nothing has to be guessed at', async () => {
    const { client, create } = fakeClient(jsonResponse(transcription));

    await extractRecipeFromImage({ image: validBase64, createClient: () => client });

    const [request] = create.mock.calls[0];
    expect(request.output_config.format).toEqual({
      type: 'json_schema',
      schema: RECIPE_OUTPUT_SCHEMA,
    });
  });

  it('leaves room for the answer under the token cap', async () => {
    const { client, create } = fakeClient(jsonResponse(transcription));
    await extractRecipeFromImage({ image: validBase64, createClient: () => client });
    expect(create.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(4096);
  });

  it('tells the model not to invent anything it cannot read', async () => {
    const { client, create } = fakeClient(jsonResponse(transcription));
    await extractRecipeFromImage({ image: validBase64, createClient: () => client });
    expect(create.mock.calls[0][0].system).toMatch(/never invent/i);
  });

  it('turns a self-declared unreadable photo into advice, not a recipe', async () => {
    const { client } = fakeClient(
      jsonResponse({ ...transcription, readable: false, warnings: ['The card is out of focus.'] })
    );

    const err = await extractRecipeFromImage({
      image: validBase64,
      createClient: () => client,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UnreadableImageError);
    expect(err.message).toMatch(/more light/i);
    expect(err.details).toEqual(['The card is out of focus.']);
  });

  it('never calls the API when the image is rejected up front', async () => {
    const { client, create } = fakeClient(jsonResponse(transcription));

    await expect(
      extractRecipeFromImage({ image: 'AAAA', createClient: () => client })
    ).rejects.toBeInstanceOf(UnreadableImageError);

    expect(create).not.toHaveBeenCalled();
  });

  it('does not leak the upstream error text, which can echo the request', async () => {
    const create = jest.fn(async () => {
      throw Object.assign(new Error('request body: <base64 of a private photo>'), { status: 500 });
    });

    const err = await extractRecipeFromImage({
      image: validBase64,
      createClient: () => ({ messages: { create } }),
    }).catch((e) => e);

    expect(err).toBeInstanceOf(VisionRequestError);
    expect(err.message).toBe('The AI service could not be reached. Try again in a moment.');
    expect(err.status).toBe(500);
  });
});
