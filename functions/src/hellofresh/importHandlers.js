// functions/src/hellofresh/importHandlers.js
//
// The two HTTP entry points behind HelloFresh import.
//
// Both of them *parse only*. Neither writes to Firestore: the browser saves the
// recipe under the signed-in user's own credentials once the cook has reviewed
// it, so the `recipes` security rules stay in force and an unauthenticated HTTP
// function never writes on someone's behalf.

const functions = require('firebase-functions');

const {
  MissingApiKeyError,
  UnreadableImageError,
  VisionRequestError,
  extractRecipeFromImage,
} = require('./claudeVision');

const {
  InvalidRecipeUrlError,
  RecipeFetchError,
  RecipeNotFoundError,
  scrapeHelloFreshRecipe,
} = require('./helloFreshScraper');

const { normalizeRecipe } = require('./recipeNormalizer');

/** Map a thrown error onto an HTTP status and a message a cook can act on. */
function describeError(err) {
  if (err instanceof MissingApiKeyError) {
    return {
      status: 503,
      code: 'vision-not-configured',
      message: 'Photo import is switched off on this deployment. Enter the recipe by hand instead.',
    };
  }
  if (err instanceof UnreadableImageError) {
    return {
      status: 422,
      code: err.code,
      message: err.message,
      details: err.details ?? [],
    };
  }
  if (err instanceof InvalidRecipeUrlError) {
    return { status: 400, code: err.code, message: err.message };
  }
  if (err instanceof RecipeNotFoundError) {
    return { status: 404, code: err.code, message: err.message };
  }
  if (err instanceof VisionRequestError || err instanceof RecipeFetchError) {
    return { status: 502, code: err.code, message: err.message };
  }
  return {
    status: 500,
    code: 'internal',
    message: 'Something went wrong on our side. Try again in a moment.',
  };
}

/** Shared CORS + method handling. Returns true when the request is done. */
function handlePreflight(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }

  if (req.method !== 'POST') {
    res.status(405).json({
      status: 'error',
      code: 'method-not-allowed',
      message: 'Use POST.',
    });
    return true;
  }

  return false;
}

/** Build the JSON body both handlers return on success. */
function successBody(raw, options) {
  const { recipe, warnings } = normalizeRecipe(raw, options);
  return {
    status: 'success',
    recipe,
    warnings,
    // The cook must confirm before this is saved; the client stamps createdAt.
    needsReview: true,
  };
}

/**
 * POST { image, mediaType } → a reviewable HelloFresh recipe draft.
 *
 * `image` may be raw base64 or a `data:image/jpeg;base64,...` URL.
 */
const importHelloFreshFromPhoto = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    if (handlePreflight(req, res)) return;

    const { image, mediaType } = req.body ?? {};

    if (!image) {
      res.status(400).json({
        status: 'error',
        code: 'invalid-request',
        message: 'No photo was received. Take a picture of the recipe card and try again.',
      });
      return;
    }

    try {
      const raw = await extractRecipeFromImage({
        image,
        mediaType,
        functionsConfig: readFunctionsConfig(),
      });
      res.status(200).json(successBody(raw, {}));
    } catch (err) {
      const described = describeError(err);
      console.error(`HelloFresh photo import failed: ${described.code}`);
      res.status(described.status).json({
        status: 'error',
        code: described.code,
        message: described.message,
        details: described.details ?? [],
      });
    }
  });

/**
 * POST { url } → a reviewable HelloFresh recipe draft scraped from the page.
 */
const importHelloFreshFromUrl = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    if (handlePreflight(req, res)) return;

    const { url } = req.body ?? {};

    if (!url) {
      res.status(400).json({
        status: 'error',
        code: 'invalid-request',
        message: 'No link was received. Paste a HelloFresh recipe link and try again.',
      });
      return;
    }

    try {
      const raw = await scrapeHelloFreshRecipe(url);
      res.status(200).json(successBody(raw, { sourceUrl: url, imageUrl: raw.imageUrl }));
    } catch (err) {
      const described = describeError(err);
      console.error(`HelloFresh URL import failed: ${described.code}`);
      res.status(described.status).json({
        status: 'error',
        code: described.code,
        message: described.message,
      });
    }
  });

/** `functions.config()` throws outside a deployed runtime — treat that as unset. */
function readFunctionsConfig() {
  try {
    return functions.config();
  } catch (err) {
    return {};
  }
}

module.exports = {
  describeError,
  handlePreflight,
  importHelloFreshFromPhoto,
  importHelloFreshFromUrl,
  readFunctionsConfig,
  successBody,
};
