// functions/src/hellofresh/claudeVision.js
//
// Reads a photograph of a HelloFresh recipe card with Claude Vision.
//
// The API key comes from the environment (ANTHROPIC_API_KEY) or Firebase
// Functions config (anthropic.key). When neither is set the feature degrades:
// callers get a MissingApiKeyError they can turn into "AI import is off, enter
// the recipe by hand" rather than a 500.
//
// Nothing in here is ever called from a test with a real key — see
// __tests__/claudeVision.test.js, which mocks the Anthropic client outright.

const MODEL = 'claude-opus-5';

// Claude's own guidance: 5MB per image on the API. Anything larger is a photo
// straight off a phone camera that the browser should have downscaled.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Raised when no Anthropic credential is configured. */
class MissingApiKeyError extends Error {
  constructor(message = 'Claude Vision is not configured on this deployment.') {
    super(message);
    this.name = 'MissingApiKeyError';
    this.code = 'vision-not-configured';
  }
}

/** Raised when the photo itself is the problem, not the request. */
class UnreadableImageError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'UnreadableImageError';
    this.code = 'unreadable-image';
    this.details = details;
  }
}

/** Raised when the upstream model call fails for any other reason. */
class VisionRequestError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'VisionRequestError';
    this.code = 'vision-request-failed';
    this.status = status;
  }
}

// The model is asked for exactly this shape, so the parser downstream never has
// to guess. Structured outputs reject numeric/length constraints, so bounds are
// enforced in recipeNormalizer instead.
const RECIPE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    readable: {
      type: 'boolean',
      description: 'False when the photo is too blurry, dark, or cropped to read reliably.',
    },
    name: { type: 'string', description: 'Recipe title. Empty string if unreadable.' },
    servings: { type: 'integer', description: 'Portions the card makes. Use 2 if not stated.' },
    prepTime: { type: 'integer', description: 'Prep minutes. Use 0 if not stated.' },
    cookTime: { type: 'integer', description: 'Cook minutes. Use 0 if not stated.' },
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short lowercase labels, e.g. "chicken", "one-pan", "spicy".',
    },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Ingredient without the amount, e.g. "tomato paste".' },
          quantity: { type: 'number', description: 'Numeric amount. Use 1 when the card gives none.' },
          unit: { type: 'string', description: 'Unit as printed, e.g. "g", "tbsp", "clove". May be empty.' },
        },
        required: ['name', 'quantity', 'unit'],
        additionalProperties: false,
      },
    },
    instructions: {
      type: 'array',
      items: { type: 'string' },
      description: 'One entry per numbered step, in order.',
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything you had to guess at or could not read, phrased for a home cook.',
    },
  },
  required: [
    'readable',
    'name',
    'servings',
    'prepTime',
    'cookTime',
    'difficulty',
    'tags',
    'ingredients',
    'instructions',
    'warnings',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'You transcribe photographs of HelloFresh recipe cards into structured data.',
  'Transcribe only what the card actually shows. Never invent an ingredient, a quantity, or a step.',
  'If part of the card is unreadable, leave those fields empty and say what you could not read in `warnings`.',
  'Set `readable` to false when the photo is too blurry, dark, glare-covered, or cropped for a reliable transcription.',
].join(' ');

const USER_PROMPT = [
  'Transcribe this HelloFresh recipe card.',
  'Include every ingredient from the ingredient panel and every numbered cooking step.',
  'Keep quantities in the units printed on the card.',
].join(' ');

/** The configured Anthropic API key, or null when the feature is switched off. */
function getApiKey(functionsConfig) {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const fromConfig = functionsConfig?.anthropic?.key;
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();

  return null;
}

/** Whether photo import can run at all on this deployment. */
function isVisionConfigured(functionsConfig) {
  return getApiKey(functionsConfig) !== null;
}

/** Rough decoded size of a base64 payload, without allocating a Buffer. */
function base64ByteLength(data) {
  const clean = String(data ?? '').replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

/**
 * Accept both a bare base64 string and a `data:image/jpeg;base64,...` URL,
 * because the browser's FileReader produces the latter.
 *
 * @returns {{ data: string, mediaType: string|null }}
 */
function splitDataUrl(image) {
  const raw = String(image ?? '').trim();
  const match = raw.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/i);
  if (match) return { data: match[2], mediaType: match[1].toLowerCase() };
  return { data: raw, mediaType: null };
}

/**
 * Validate the incoming image and return the pieces the API call needs.
 *
 * @throws {UnreadableImageError} when the payload cannot be sent at all
 */
function prepareImage(image, declaredMediaType) {
  const { data, mediaType: embedded } = splitDataUrl(image);

  if (!data) {
    throw new UnreadableImageError('No image data was received. Take the photo again.');
  }

  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) {
    throw new UnreadableImageError('That image could not be decoded. Try taking the photo again.');
  }

  const mediaType = String(embedded ?? declaredMediaType ?? 'image/jpeg').toLowerCase();
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    throw new UnreadableImageError(
      `Photos must be JPEG, PNG, GIF, or WebP — this one was ${mediaType}.`
    );
  }

  const bytes = base64ByteLength(data);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new UnreadableImageError(
      'That photo is too large to read. Take it again at a lower resolution.'
    );
  }
  if (bytes < 1024) {
    throw new UnreadableImageError('That photo is too small to read anything from.');
  }

  return { data, mediaType };
}

/** Pull the model's JSON answer out of the response content blocks. */
function readStructuredOutput(message) {
  if (message?.stop_reason === 'refusal') {
    throw new VisionRequestError('The AI declined to read that image.');
  }

  const textBlock = (message?.content ?? []).find((block) => block?.type === 'text');
  if (!textBlock?.text) {
    if (message?.stop_reason === 'max_tokens') {
      throw new VisionRequestError(
        'The card was too long to transcribe in one pass. Photograph one side at a time.'
      );
    }
    throw new VisionRequestError('The AI returned an empty response.');
  }

  try {
    return JSON.parse(textBlock.text);
  } catch (err) {
    throw new VisionRequestError('The AI returned a response that could not be read.');
  }
}

/**
 * Ask Claude Vision to transcribe a recipe-card photo.
 *
 * @param {object}   params
 * @param {string}   params.image           base64 payload or a data: URL
 * @param {string}  [params.mediaType]      MIME type when the payload is bare base64
 * @param {object}  [params.functionsConfig] Firebase Functions config, for the key
 * @param {Function}[params.createClient]   injection point for tests
 * @returns {Promise<object>} the raw structured transcription
 */
async function extractRecipeFromImage({
  image,
  mediaType: declaredMediaType,
  functionsConfig,
  createClient,
} = {}) {
  const apiKey = getApiKey(functionsConfig);
  if (!apiKey) throw new MissingApiKeyError();

  const { data, mediaType } = prepareImage(image, declaredMediaType);

  const client = createClient
    ? createClient(apiKey)
    : new (require('@anthropic-ai/sdk').Anthropic)({ apiKey });

  let message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: RECIPE_OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof UnreadableImageError || err instanceof VisionRequestError) throw err;
    // Never surface the upstream message verbatim — it can echo request content.
    throw new VisionRequestError(
      'The AI service could not be reached. Try again in a moment.',
      err?.status ?? null
    );
  }

  const parsed = readStructuredOutput(message);

  if (parsed?.readable === false) {
    throw new UnreadableImageError(
      'That photo was too hard to read. Try again with more light and the card filling the frame.',
      Array.isArray(parsed.warnings) ? parsed.warnings : []
    );
  }

  return parsed;
}

module.exports = {
  MAX_IMAGE_BYTES,
  MODEL,
  MissingApiKeyError,
  RECIPE_OUTPUT_SCHEMA,
  SUPPORTED_MEDIA_TYPES,
  UnreadableImageError,
  VisionRequestError,
  base64ByteLength,
  extractRecipeFromImage,
  getApiKey,
  isVisionConfigured,
  prepareImage,
  readStructuredOutput,
  splitDataUrl,
};
