/**
 * Spoonacular lookup. The HTTP client is a fake in every test here — a suite
 * that spends the project's API quota is a suite nobody can run twice.
 */

const { findInstructions, parseInstructions, stripHtml, DEFAULT_COST_PER_CALL } = require('../spoonacular');

/** An axios-alike that records the request it was given. */
const fakeHttp = (response) => ({
  get: jest.fn(async () => response),
});

const MATCH = {
  data: {
    results: [
      {
        id: 12345,
        title: 'Sheet Pan Salmon',
        image: 'https://img.spoonacular.test/12345.jpg',
        readyInMinutes: 25,
        servings: 2,
        analyzedInstructions: [
          { steps: [{ step: 'Heat the oven to 220C.' }, { step: 'Roast for 15 minutes.' }] },
        ],
      },
    ],
  },
};

describe('stripHtml', () => {
  it('turns Spoonacular list markup into plain text', () => {
    expect(stripHtml('<ol><li>Boil water</li><li>Add pasta</li></ol>')).toContain('Boil water');
  });

  it('decodes the entities Spoonacular emits', () => {
    expect(stripHtml('Salt &amp; pepper')).toBe('Salt & pepper');
  });
});

describe('parseInstructions', () => {
  it('prefers the structured steps', () => {
    expect(parseInstructions(MATCH.data.results[0])).toEqual([
      'Heat the oven to 220C.',
      'Roast for 15 minutes.',
    ]);
  });

  it('falls back to the plain-text field', () => {
    expect(parseInstructions({ instructions: 'Step one\nStep two' })).toEqual([
      'Step one',
      'Step two',
    ]);
  });

  it('returns nothing when the recipe carries no instructions', () => {
    expect(parseInstructions({})).toEqual([]);
  });
});

describe('findInstructions', () => {
  it('returns the matched instructions and metadata', async () => {
    const http = fakeHttp(MATCH);

    const result = await findInstructions('Sheet Pan Salmon', { apiKey: 'test-key', http });

    expect(result.matched).toBe(true);
    expect(result.instructions).toHaveLength(2);
    expect(result.sourceId).toBe('spoonacular-12345');
    expect(result.imageUrl).toBe('https://img.spoonacular.test/12345.jpg');
    expect(result.servings).toBe(2);
    expect(result.cookTime).toBe(25);
  });

  it('asks for a single result with instructions included', async () => {
    const http = fakeHttp(MATCH);

    await findInstructions('Sheet Pan Salmon', { apiKey: 'test-key', http });

    const [, options] = http.get.mock.calls[0];
    expect(options.params).toMatchObject({
      query: 'Sheet Pan Salmon',
      number: 1,
      addRecipeInformation: true,
      instructionsRequired: true,
    });
  });

  it('charges the caller for every request it actually makes', async () => {
    const result = await findInstructions('Anything', { apiKey: 'k', http: fakeHttp(MATCH) });

    expect(result.cost).toBe(DEFAULT_COST_PER_CALL);
  });

  it('spends nothing when no API key is configured', async () => {
    const http = fakeHttp(MATCH);

    const result = await findInstructions('Sheet Pan Salmon', { apiKey: '', http });

    expect(result).toMatchObject({ matched: false, cost: 0, reason: 'no-api-key' });
    expect(http.get).not.toHaveBeenCalled();
  });

  it('reports no match rather than throwing when the search comes back empty', async () => {
    const result = await findInstructions('Nonsense', {
      apiKey: 'k',
      http: fakeHttp({ data: { results: [] } }),
    });

    expect(result).toMatchObject({ matched: false, reason: 'no-match' });
  });

  it('reports no match when the hit has no instructions', async () => {
    const result = await findInstructions('Thing', {
      apiKey: 'k',
      http: fakeHttp({ data: { results: [{ id: 1 }] } }),
    });

    expect(result).toMatchObject({ matched: false, reason: 'no-instructions' });
  });

  it('survives a network failure so the sync can fall through to Claude', async () => {
    const http = { get: jest.fn(async () => { throw new Error('ETIMEDOUT'); }) };

    const result = await findInstructions('Thing', { apiKey: 'k', http });

    expect(result).toMatchObject({ matched: false, reason: 'request-failed' });
    expect(result.cost).toBe(DEFAULT_COST_PER_CALL);
  });

  it('refuses to search for a nameless recipe', async () => {
    const http = fakeHttp(MATCH);

    const result = await findInstructions('   ', { apiKey: 'k', http });

    expect(result).toMatchObject({ matched: false, cost: 0 });
    expect(http.get).not.toHaveBeenCalled();
  });
});
