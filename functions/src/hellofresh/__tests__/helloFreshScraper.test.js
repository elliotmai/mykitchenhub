/**
 * URL import, against fixture HTML.
 *
 * `fetch` is injected in every case — no test may reach hellofresh.com. The
 * fixtures below are trimmed copies of the JSON-LD block real HelloFresh recipe
 * pages ship for search engines.
 */

const {
  InvalidRecipeUrlError,
  RecipeFetchError,
  RecipeNotFoundError,
  extractJsonLd,
  findRecipeNode,
  isHelloFreshUrl,
  parseImage,
  parseInstructions,
  parseIsoDuration,
  parseJsonLdRecipe,
  parseTags,
  parseYield,
  scrapeHelloFreshRecipe,
} = require('../helloFreshScraper');

const { normalizeRecipe } = require('../recipeNormalizer');

/** Wrap JSON-LD in the surrounding page markup. */
const page = (jsonLd) => `
<!doctype html><html><head>
<title>HelloFresh</title>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head><body><div id="root"></div></body></html>`;

const RECIPE_LD = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Sweet Chili Chicken',
  image: ['https://img.hellofresh.com/chicken.jpg'],
  recipeYield: ['2'],
  prepTime: 'PT10M',
  totalTime: 'PT35M',
  keywords: 'chicken, quick dinner',
  recipeCuisine: 'Asian',
  recipeIngredient: ['2 unit Chicken Breasts', '28 g Tomato Paste', '1 tbsp Olive Oil'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Preheat the oven to 425F.' },
    { '@type': 'HowToStep', text: 'Roast the chicken for 20 minutes.' },
  ],
};

describe('isHelloFreshUrl', () => {
  it.each([
    'https://www.hellofresh.com/recipes/sweet-chili-chicken-123',
    'https://hellofresh.co.uk/recipes/x',
    'https://www.hellofresh.de/recipes/x',
  ])('accepts %s', (url) => {
    expect(isHelloFreshUrl(url)).toBe(true);
  });

  it.each([
    ['a non-HelloFresh recipe site', 'https://www.allrecipes.com/recipe/1'],
    ['a lookalike domain', 'https://hellofresh.evil.com/recipes/x'],
    ['a bare hostname', 'hellofresh.com/recipes/x'],
    ['an internal address', 'http://169.254.169.254/latest/meta-data/'],
    ['a file URL', 'file:///etc/passwd'],
    ['nothing at all', ''],
  ])('rejects %s', (_label, url) => {
    expect(isHelloFreshUrl(url)).toBe(false);
  });

  it('will not fetch an arbitrary host — this is what stops it being an open proxy', async () => {
    const fetch = jest.fn();
    await expect(
      scrapeHelloFreshRecipe('http://localhost:8080/admin', { fetch })
    ).rejects.toBeInstanceOf(InvalidRecipeUrlError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('parseIsoDuration', () => {
  it.each([
    ['PT35M', 35],
    ['PT1H', 60],
    ['PT1H35M', 95],
    ['PT90S', 2],
    ['P1DT2H', 1560],
  ])('reads %s as %i minutes', (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected);
  });

  it.each([['', null], ['35 minutes', null], [undefined, null], ['PT', null]])(
    'returns null for %p',
    (input, expected) => {
      expect(parseIsoDuration(input)).toBe(expected);
    }
  );
});

describe('parseYield', () => {
  it.each([
    [['2'], 2],
    ['4 servings', 4],
    [6, 6],
  ])('reads %p as %i', (input, expected) => {
    expect(parseYield(input)).toBe(expected);
  });

  it('returns null when the page gave no number', () => {
    expect(parseYield('a family')).toBeNull();
  });
});

describe('parseImage', () => {
  it('handles a string, an array, and an ImageObject', () => {
    expect(parseImage('https://a/x.jpg')).toBe('https://a/x.jpg');
    expect(parseImage(['https://a/x.jpg', 'https://a/y.jpg'])).toBe('https://a/x.jpg');
    expect(parseImage({ '@type': 'ImageObject', url: 'https://a/x.jpg' })).toBe('https://a/x.jpg');
  });

  it('returns null when there is no image', () => {
    expect(parseImage(undefined)).toBeNull();
    expect(parseImage({})).toBeNull();
  });
});

describe('parseInstructions', () => {
  it('flattens the HowToSection > HowToStep nesting some pages use', () => {
    expect(
      parseInstructions([
        {
          '@type': 'HowToSection',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Chop.' },
            { '@type': 'HowToStep', text: 'Fry.' },
          ],
        },
        { '@type': 'HowToStep', text: 'Serve.' },
      ])
    ).toEqual(['Chop.', 'Fry.', 'Serve.']);
  });

  it('accepts plain strings', () => {
    expect(parseInstructions(['Boil water.'])).toEqual(['Boil water.']);
  });
});

describe('parseTags', () => {
  it('gathers keywords, cuisine, and category from all their shapes', () => {
    expect(
      parseTags({ keywords: 'chicken, quick', recipeCuisine: 'Asian', recipeCategory: ['Dinner'] })
    ).toEqual(['chicken', ' quick', 'Asian', 'Dinner']);
  });

  it('returns an empty list when the page had none', () => {
    expect(parseTags({})).toEqual([]);
  });
});

describe('extractJsonLd', () => {
  it('finds the recipe among several JSON-LD blocks', () => {
    const html = `
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Organization' })}</script>
      <script type="application/ld+json">${JSON.stringify(RECIPE_LD)}</script>`;

    expect(findRecipeNode(extractJsonLd(html)).name).toBe('Sweet Chili Chicken');
  });

  it('unwraps an @graph wrapper', () => {
    const html = page({ '@context': 'https://schema.org', '@graph': [RECIPE_LD] });
    expect(findRecipeNode(extractJsonLd(html)).name).toBe('Sweet Chili Chicken');
  });

  it('handles @type given as an array', () => {
    const html = page({ ...RECIPE_LD, '@type': ['Recipe', 'NewsArticle'] });
    expect(findRecipeNode(extractJsonLd(html))).not.toBeNull();
  });

  it('skips a malformed block instead of abandoning the good one', () => {
    const html = `
      <script type="application/ld+json">{ not json </script>
      <script type="application/ld+json">${JSON.stringify(RECIPE_LD)}</script>`;

    expect(findRecipeNode(extractJsonLd(html)).name).toBe('Sweet Chili Chicken');
  });

  it('returns nothing for a page with no structured data', () => {
    expect(extractJsonLd('<html><body>Hi</body></html>')).toEqual([]);
    expect(findRecipeNode([])).toBeNull();
  });
});

describe('parseJsonLdRecipe', () => {
  it('maps every field the normaliser needs', () => {
    const raw = parseJsonLdRecipe(RECIPE_LD, 'https://www.hellofresh.com/recipes/x');

    expect(raw.name).toBe('Sweet Chili Chicken');
    expect(raw.servings).toBe(2);
    expect(raw.prepTime).toBe(10);
    expect(raw.ingredients).toHaveLength(3);
    expect(raw.instructions).toHaveLength(2);
    expect(raw.imageUrl).toBe('https://img.hellofresh.com/chicken.jpg');
    expect(raw.sourceUrl).toBe('https://www.hellofresh.com/recipes/x');
  });

  it('derives cook time from total minus prep when the page gives only totalTime', () => {
    expect(parseJsonLdRecipe(RECIPE_LD).cookTime).toBe(25);
  });

  it('prefers an explicit cookTime over the derived one', () => {
    expect(parseJsonLdRecipe({ ...RECIPE_LD, cookTime: 'PT20M' }).cookTime).toBe(20);
  });

  it('refuses to build a recipe from nothing', () => {
    expect(() => parseJsonLdRecipe(null)).toThrow(RecipeNotFoundError);
  });
});

describe('scrapeHelloFreshRecipe', () => {
  const fetchReturning = (html) => jest.fn(async () => html);

  it('reads a real-shaped recipe page end to end', async () => {
    const raw = await scrapeHelloFreshRecipe('https://www.hellofresh.com/recipes/x-123', {
      fetch: fetchReturning(page(RECIPE_LD)),
    });

    const { recipe } = normalizeRecipe(raw, { sourceUrl: raw.sourceUrl, imageUrl: raw.imageUrl });

    // The shape the recipes rules require on create.
    expect(recipe.source).toBe('hellofresh');
    expect(recipe.servings).toBe(2);
    expect(recipe.difficulty).toBe('medium');
    expect(recipe.timesCooked).toBe(0);
    expect(recipe.ingredients[1]).toEqual({
      name: 'Tomato Paste',
      quantity: 28,
      unit: 'g',
      normalized: 'tomato paste',
    });
    expect(recipe.tags).toContain('hellofresh');
    expect(recipe.tags).toContain('chicken');
  });

  it.each([
    ['a recipe with sections', { ...RECIPE_LD, recipeInstructions: 'Chop.\nFry.\nServe.' }],
    ['a recipe with no image', { ...RECIPE_LD, image: undefined }],
    ['a recipe with no yield', { ...RECIPE_LD, recipeYield: undefined }],
    ['a recipe with no timings', { ...RECIPE_LD, prepTime: undefined, totalTime: undefined }],
  ])('still produces a valid document for %s', async (_label, ld) => {
    const raw = await scrapeHelloFreshRecipe('https://www.hellofresh.com/recipes/x', {
      fetch: fetchReturning(page(ld)),
    });
    const { recipe } = normalizeRecipe(raw);

    expect(recipe.servings).toBeGreaterThan(0);
    expect(['easy', 'medium', 'hard']).toContain(recipe.difficulty);
    expect(recipe.instructions.length).toBeGreaterThan(0);
  });

  it('points the cook at photo import when the page has no recipe data', async () => {
    await expect(
      scrapeHelloFreshRecipe('https://www.hellofresh.com/recipes/x', {
        fetch: fetchReturning('<html><body>Loading…</body></html>'),
      })
    ).rejects.toThrow(/photo import/i);
  });

  it('surfaces a fetch failure as something the cook can act on', async () => {
    const fetch = jest.fn(async () => {
      throw new RecipeFetchError('That recipe page could not be found.', 404);
    });

    const err = await scrapeHelloFreshRecipe('https://www.hellofresh.com/recipes/x', {
      fetch,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(RecipeFetchError);
    expect(err.status).toBe(404);
  });
});
