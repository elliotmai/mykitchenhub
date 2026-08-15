/**
 * The HTTP surface: status codes, CORS, and — most importantly — that neither
 * handler writes to Firestore. Both parse only; the browser saves the reviewed
 * recipe under the signed-in user's own credentials so the `recipes` rules stay
 * in force.
 *
 * Claude Vision and the page fetch are both mocked. Nothing here touches the
 * network or costs money.
 */

jest.mock('../claudeVision', () => {
  const actual = jest.requireActual('../claudeVision');
  return { ...actual, extractRecipeFromImage: jest.fn() };
});

jest.mock('../helloFreshScraper', () => {
  const actual = jest.requireActual('../helloFreshScraper');
  return { ...actual, scrapeHelloFreshRecipe: jest.fn() };
});

const {
  MissingApiKeyError,
  UnreadableImageError,
  VisionRequestError,
  extractRecipeFromImage,
} = require('../claudeVision');

const {
  InvalidRecipeUrlError,
  RecipeFetchError,
  RecipeNotFoundError,
  scrapeHelloFreshRecipe,
} = require('../helloFreshScraper');

const {
  describeError,
  handlePreflight,
  importHelloFreshFromPhoto,
  importHelloFreshFromUrl,
  successBody,
} = require('../importHandlers');

/** A minimal Express-alike response that records what was sent. */
const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set: jest.fn((key, value) => {
      res.headers[key] = value;
      return res;
    }),
    status: jest.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((payload) => {
      res.body = payload;
      return res;
    }),
    send: jest.fn((payload) => {
      res.body = payload;
      return res;
    }),
  };
  return res;
};

const makeReq = (body = {}, method = 'POST') => ({ method, body });

const transcription = {
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('describeError', () => {
  it.each([
    [new MissingApiKeyError(), 503, 'vision-not-configured'],
    [new UnreadableImageError('too blurry'), 422, 'unreadable-image'],
    [new InvalidRecipeUrlError(), 400, 'invalid-url'],
    [new RecipeNotFoundError(), 404, 'recipe-not-found'],
    [new VisionRequestError('upstream down'), 502, 'vision-request-failed'],
    [new RecipeFetchError('page down'), 502, 'fetch-failed'],
    [new Error('something unexpected'), 500, 'internal'],
  ])('maps %p to %i %s', (err, status, code) => {
    expect(describeError(err)).toMatchObject({ status, code });
  });

  it('does not leak an unexpected error message to the caller', () => {
    expect(describeError(new Error('ENOENT /srv/service-account.json')).message).not.toMatch(
      /service-account/
    );
  });
});

describe('handlePreflight', () => {
  it('answers an OPTIONS preflight without running the handler', () => {
    const res = makeRes();
    expect(handlePreflight(makeReq({}, 'OPTIONS'), res)).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('rejects a GET', () => {
    const res = makeRes();
    expect(handlePreflight(makeReq({}, 'GET'), res)).toBe(true);
    expect(res.statusCode).toBe(405);
  });

  it('lets a POST through with CORS headers set', () => {
    const res = makeRes();
    expect(handlePreflight(makeReq(), res)).toBe(false);
    expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
  });
});

describe('successBody', () => {
  it('returns a normalised recipe plus any warnings, flagged for review', () => {
    const body = successBody(transcription, {});

    expect(body.status).toBe('success');
    expect(body.needsReview).toBe(true);
    expect(body.recipe.source).toBe('hellofresh');
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('never returns createdAt — the client stamps it when it saves', () => {
    expect(successBody(transcription, {}).recipe).not.toHaveProperty('createdAt');
  });
});

describe('importHelloFreshFromPhoto', () => {
  it('returns a reviewable draft for a readable card', async () => {
    extractRecipeFromImage.mockResolvedValue(transcription);
    const res = makeRes();

    await importHelloFreshFromPhoto(makeReq({ image: 'AAAA', mediaType: 'image/jpeg' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.recipe.name).toBe('Sweet Chili Chicken');
    expect(res.body.recipe.source).toBe('hellofresh');
    expect(res.body.needsReview).toBe(true);
  });

  it('passes the declared media type through to the vision call', async () => {
    extractRecipeFromImage.mockResolvedValue(transcription);

    await importHelloFreshFromPhoto(makeReq({ image: 'AAAA', mediaType: 'image/png' }), makeRes());

    expect(extractRecipeFromImage).toHaveBeenCalledWith(
      expect.objectContaining({ image: 'AAAA', mediaType: 'image/png' })
    );
  });

  it('asks for a photo rather than calling the model with nothing', async () => {
    const res = makeRes();
    await importHelloFreshFromPhoto(makeReq({}), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('invalid-request');
    expect(extractRecipeFromImage).not.toHaveBeenCalled();
  });

  it('tells the cook to enter it by hand when Vision is not configured', async () => {
    extractRecipeFromImage.mockRejectedValue(new MissingApiKeyError());
    const res = makeRes();

    await importHelloFreshFromPhoto(makeReq({ image: 'AAAA' }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('vision-not-configured');
    expect(res.body.message).toMatch(/by hand/i);
  });

  it('explains a poor-quality photo and hands back what the model noticed', async () => {
    extractRecipeFromImage.mockRejectedValue(
      new UnreadableImageError('That photo was too hard to read.', ['Glare over the ingredients.'])
    );
    const res = makeRes();

    await importHelloFreshFromPhoto(makeReq({ image: 'AAAA' }), res);

    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('unreadable-image');
    expect(res.body.details).toEqual(['Glare over the ingredients.']);
  });

  it('reports an upstream outage as a bad gateway, not a client mistake', async () => {
    extractRecipeFromImage.mockRejectedValue(new VisionRequestError('upstream down'));
    const res = makeRes();

    await importHelloFreshFromPhoto(makeReq({ image: 'AAAA' }), res);

    expect(res.statusCode).toBe(502);
  });

  it('does not crash when the request has no body at all', async () => {
    const res = makeRes();
    await importHelloFreshFromPhoto({ method: 'POST' }, res);
    expect(res.statusCode).toBe(400);
  });

  it('answers a preflight without calling the model', async () => {
    const res = makeRes();
    await importHelloFreshFromPhoto(makeReq({}, 'OPTIONS'), res);

    expect(res.statusCode).toBe(204);
    expect(extractRecipeFromImage).not.toHaveBeenCalled();
  });
});

describe('importHelloFreshFromUrl', () => {
  const scraped = {
    ...transcription,
    ingredients: ['2 unit Chicken Breasts'],
    imageUrl: 'https://img.hellofresh.com/x.jpg',
  };

  it('returns a reviewable draft scraped from the page', async () => {
    scrapeHelloFreshRecipe.mockResolvedValue(scraped);
    const res = makeRes();

    await importHelloFreshFromUrl(
      makeReq({ url: 'https://www.hellofresh.com/recipes/x-123' }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.recipe.sourceUrl).toBe('https://www.hellofresh.com/recipes/x-123');
    expect(res.body.recipe.imageUrl).toBe('https://img.hellofresh.com/x.jpg');
    expect(res.body.recipe.source).toBe('hellofresh');
  });

  it('asks for a link rather than fetching nothing', async () => {
    const res = makeRes();
    await importHelloFreshFromUrl(makeReq({}), res);

    expect(res.statusCode).toBe(400);
    expect(scrapeHelloFreshRecipe).not.toHaveBeenCalled();
  });

  it('rejects a link that is not HelloFresh', async () => {
    scrapeHelloFreshRecipe.mockRejectedValue(new InvalidRecipeUrlError());
    const res = makeRes();

    await importHelloFreshFromUrl(makeReq({ url: 'https://example.com/recipe' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('invalid-url');
  });

  it('reports a page with no recipe on it as not found', async () => {
    scrapeHelloFreshRecipe.mockRejectedValue(new RecipeNotFoundError());
    const res = makeRes();

    await importHelloFreshFromUrl(makeReq({ url: 'https://www.hellofresh.com/x' }), res);

    expect(res.statusCode).toBe(404);
  });

  it('reports an unreachable page as a bad gateway', async () => {
    scrapeHelloFreshRecipe.mockRejectedValue(new RecipeFetchError('page down'));
    const res = makeRes();

    await importHelloFreshFromUrl(makeReq({ url: 'https://www.hellofresh.com/x' }), res);

    expect(res.statusCode).toBe(502);
  });

  it('answers a preflight without fetching', async () => {
    const res = makeRes();
    await importHelloFreshFromUrl(makeReq({}, 'OPTIONS'), res);

    expect(res.statusCode).toBe(204);
    expect(scrapeHelloFreshRecipe).not.toHaveBeenCalled();
  });
});
