// functions/src/hellofresh/helloFreshScraper.js
//
// Reads a HelloFresh recipe page and pulls the schema.org Recipe out of its
// JSON-LD block. HelloFresh renders the recipe client-side, so scraping the
// rendered HTML would need a browser — but every recipe page ships a complete
// `application/ld+json` Recipe for search engines, which is both cheaper and
// far more stable than CSS selectors.
//
// Tests never hit the network: `fetchPage` is injectable and the suite passes a
// fake that returns fixture HTML.

const axios = require('axios');

// The suffix is enumerated rather than matched loosely. `hellofresh.[a-z.]+`
// would accept `hellofresh.evil.com`, which is exactly the lookalike an
// attacker registers to point this function at a host of their choosing.
const ALLOWED_HOST_PATTERN =
  /(^|\.)hellofresh\.(?:com|co\.uk|com\.au|co\.nz|de|nl|be|fr|ca|se|dk|no|ch|at|it|es|lu|ie|jp)$/i;

const REQUEST_TIMEOUT_MS = 10000;

// Enough to satisfy HelloFresh's edge without pretending to be a person.
const USER_AGENT = 'MyKitchenHub/1.0 (+recipe import)';

/** Raised when the URL is not a HelloFresh recipe page. */
class InvalidRecipeUrlError extends Error {
  constructor(message = 'That does not look like a HelloFresh recipe link.') {
    super(message);
    this.name = 'InvalidRecipeUrlError';
    this.code = 'invalid-url';
  }
}

/** Raised when the page loaded but held no recipe we could read. */
class RecipeNotFoundError extends Error {
  constructor(message = 'No recipe details were found on that page.') {
    super(message);
    this.name = 'RecipeNotFoundError';
    this.code = 'recipe-not-found';
  }
}

/** Raised when the page could not be fetched at all. */
class RecipeFetchError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'RecipeFetchError';
    this.code = 'fetch-failed';
    this.status = status;
  }
}

/**
 * Is this a HelloFresh URL we are willing to fetch?
 *
 * Restricting the host is what stops this function being an open proxy: without
 * it, anyone could POST an internal address and read the response body back.
 */
function isHelloFreshUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch (err) {
    return false;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return ALLOWED_HOST_PATTERN.test(url.hostname);
}

/** Every `application/ld+json` payload on the page, parsed and flattened. */
function extractJsonLd(html) {
  const nodes = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match = pattern.exec(html);
  while (match !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      // A page may ship a single object, an array, or an @graph wrapper.
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      candidates.forEach((node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node['@graph'])) nodes.push(...node['@graph']);
        else nodes.push(node);
      });
    } catch (err) {
      // A malformed block on the page is not a reason to abandon the others.
    }
    match = pattern.exec(html);
  }

  return nodes;
}

/** The first JSON-LD node that claims to be a Recipe. */
function findRecipeNode(nodes) {
  return (
    nodes.find((node) => {
      const type = node?.['@type'];
      if (Array.isArray(type)) return type.includes('Recipe');
      return type === 'Recipe';
    }) ?? null
  );
}

/** ISO-8601 duration ("PT1H35M") to whole minutes. */
function parseIsoDuration(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;

  const total =
    Number(days ?? 0) * 1440 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Number(seconds ?? 0) / 60;

  return Math.round(total);
}

/** schema.org yield fields are "2 servings", "2", or ["2"]. */
function parseYield(value) {
  const first = Array.isArray(value) ? value[0] : value;
  const match = String(first ?? '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

/** schema.org image is a string, an array, or an ImageObject. */
function parseImage(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && typeof first.url === 'string') return first.url;
  return null;
}

/** Flatten recipeInstructions, which nests HowToSection > HowToStep. */
function parseInstructions(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];

  return list.flatMap((entry) => {
    if (typeof entry === 'string') return [entry.trim()];
    if (!entry || typeof entry !== 'object') return [];
    if (Array.isArray(entry.itemListElement)) return parseInstructions(entry.itemListElement);
    const text = entry.text ?? entry.name;
    return text ? [String(text).trim()] : [];
  });
}

/** Keywords/cuisine/category, all of which may be a string or an array. */
function parseTags(node) {
  const raw = [node?.keywords, node?.recipeCuisine, node?.recipeCategory];
  return raw.flatMap((value) => {
    if (Array.isArray(value)) return value.map((tag) => String(tag));
    if (typeof value === 'string') return value.split(',');
    return [];
  });
}

/**
 * Map a schema.org Recipe onto the loose shape recipeNormalizer accepts.
 *
 * @param {object} node
 * @param {string} [sourceUrl]
 */
function parseJsonLdRecipe(node, sourceUrl) {
  if (!node) throw new RecipeNotFoundError();

  const prepTime = parseIsoDuration(node.prepTime);
  const cookTime = parseIsoDuration(node.cookTime);
  const totalTime = parseIsoDuration(node.totalTime);

  return {
    name: node.name ?? '',
    ingredients: Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [],
    instructions: parseInstructions(node.recipeInstructions),
    servings: parseYield(node.recipeYield),
    // HelloFresh often gives totalTime only; treat it as cook time so the
    // difficulty heuristic still has something to work with.
    prepTime,
    cookTime: cookTime ?? (prepTime !== null && totalTime !== null ? totalTime - prepTime : totalTime),
    tags: parseTags(node),
    imageUrl: parseImage(node.image),
    sourceUrl: sourceUrl ?? null,
  };
}

/** Fetch a page's HTML. Split out so tests can supply their own. */
async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 3,
      responseType: 'text',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      // Read the body ourselves for non-2xx so the message can be specific.
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      throw new RecipeFetchError(
        response.status === 404
          ? 'That recipe page could not be found.'
          : 'That recipe page could not be loaded right now.',
        response.status
      );
    }

    return String(response.data ?? '');
  } catch (err) {
    if (err instanceof RecipeFetchError) throw err;
    throw new RecipeFetchError('That recipe page could not be loaded right now.');
  }
}

/**
 * Fetch a HelloFresh recipe page and return the raw recipe shape.
 *
 * @param {string}   url
 * @param {object}  [deps]
 * @param {Function}[deps.fetch] override for tests
 */
async function scrapeHelloFreshRecipe(url, deps = {}) {
  if (!isHelloFreshUrl(url)) throw new InvalidRecipeUrlError();

  const html = await (deps.fetch ?? fetchPage)(url);
  const node = findRecipeNode(extractJsonLd(html));

  if (!node) {
    throw new RecipeNotFoundError(
      'That page did not contain recipe details we could read. Try the photo import instead.'
    );
  }

  return parseJsonLdRecipe(node, url);
}

module.exports = {
  InvalidRecipeUrlError,
  RecipeFetchError,
  RecipeNotFoundError,
  extractJsonLd,
  fetchPage,
  findRecipeNode,
  isHelloFreshUrl,
  parseImage,
  parseInstructions,
  parseIsoDuration,
  parseJsonLdRecipe,
  parseTags,
  parseYield,
  scrapeHelloFreshRecipe,
};
