// The network boundary for HelloFresh import. `fetch` is stubbed in every case
// — nothing here reaches a Cloud Function or the Anthropic API.

import {
  HelloFreshImportError,
  MAX_IMAGE_BYTES,
  base64ByteLength,
  downscaleImage,
  functionsBaseUrl,
  importFromPhoto,
  importFromUrl,
  isImportConfigured,
  looksLikeHelloFreshUrl,
  readImageFile,
} from '../helloFreshApi';

const BASE = 'https://functions.test/mykitchenhub';

const okResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const errorResponse = (status, body) => ({
  ok: false,
  status,
  json: async () => body,
});

const recipe = { name: 'Sweet Chili Chicken', source: 'hellofresh' };

let originalFunctionsUrl;

beforeEach(() => {
  originalFunctionsUrl = process.env.REACT_APP_FIREBASE_FUNCTIONS_URL;
  global.fetch = jest.fn();
});

afterEach(() => {
  process.env.REACT_APP_FIREBASE_FUNCTIONS_URL = originalFunctionsUrl;
  delete global.fetch;
});

describe('configuration', () => {
  it('reports the configured functions URL', () => {
    expect(functionsBaseUrl()).toBe(BASE);
    expect(isImportConfigured()).toBe(true);
  });

  it('trims a trailing slash so the path never doubles up', () => {
    process.env.REACT_APP_FIREBASE_FUNCTIONS_URL = `${BASE}/`;
    expect(functionsBaseUrl()).toBe(BASE);
  });

  it('degrades gracefully when the build has no functions URL', async () => {
    delete process.env.REACT_APP_FIREBASE_FUNCTIONS_URL;

    expect(isImportConfigured()).toBe(false);

    const err = await importFromUrl('https://www.hellofresh.com/recipes/x').catch((e) => e);
    expect(err).toBeInstanceOf(HelloFreshImportError);
    expect(err.code).toBe('not-configured');
    expect(err.message).toMatch(/by hand/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('looksLikeHelloFreshUrl', () => {
  it.each([
    'https://www.hellofresh.com/recipes/sweet-chili-chicken-123',
    'https://hellofresh.co.uk/recipes/x',
    'https://www.hellofresh.com.au/recipes/x',
  ])('accepts %s', (url) => {
    expect(looksLikeHelloFreshUrl(url)).toBe(true);
  });

  it.each([
    'https://www.allrecipes.com/recipe/1',
    'https://hellofresh.evil.com/recipes/x',
    'https://nothellofresh.com/recipes/x',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(looksLikeHelloFreshUrl(url)).toBe(false);
  });
});

describe('importFromUrl', () => {
  it('posts the link and returns the draft with its warnings', async () => {
    global.fetch.mockResolvedValue(
      okResponse({ status: 'success', recipe, warnings: ['Step 3 was cut off.'] })
    );

    const result = await importFromUrl('  https://www.hellofresh.com/recipes/x  ');

    expect(result).toEqual({ recipe, warnings: ['Step 3 was cut off.'] });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/importHelloFreshFromUrl`);
    expect(init.method).toBe('POST');
    // Whitespace from a paste must not reach the function.
    expect(JSON.parse(init.body)).toEqual({ url: 'https://www.hellofresh.com/recipes/x' });
  });

  it("surfaces the function's own message and code", async () => {
    global.fetch.mockResolvedValue(
      errorResponse(404, {
        status: 'error',
        code: 'recipe-not-found',
        message: 'No recipe details were found on that page.',
      })
    );

    const err = await importFromUrl('https://www.hellofresh.com/recipes/x').catch((e) => e);

    expect(err.code).toBe('recipe-not-found');
    expect(err.message).toBe('No recipe details were found on that page.');
  });

  it('treats an error body on a 200 as a failure', async () => {
    global.fetch.mockResolvedValue(
      okResponse({ status: 'error', code: 'invalid-url', message: 'Not a HelloFresh link.' })
    );

    await expect(importFromUrl('https://www.hellofresh.com/x')).rejects.toMatchObject({
      code: 'invalid-url',
    });
  });

  it('reports a transport failure as a network problem', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await importFromUrl('https://www.hellofresh.com/x').catch((e) => e);
    expect(err.code).toBe('network');
  });

  it('handles a response body that is not JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const err = await importFromUrl('https://www.hellofresh.com/x').catch((e) => e);
    expect(err.code).toBe('unknown');
  });

  it('rejects a success response with no recipe in it', async () => {
    global.fetch.mockResolvedValue(okResponse({ status: 'success' }));

    await expect(importFromUrl('https://www.hellofresh.com/x')).rejects.toMatchObject({
      code: 'unknown',
    });
  });

  it('does not attempt a request while offline', async () => {
    const spy = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const err = await importFromUrl('https://www.hellofresh.com/x').catch((e) => e);

    expect(err.code).toBe('offline');
    expect(global.fetch).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('importFromPhoto', () => {
  it('posts the image payload to the photo function', async () => {
    global.fetch.mockResolvedValue(okResponse({ status: 'success', recipe, warnings: [] }));

    await importFromPhoto({ image: 'QUFB', mediaType: 'image/png' });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/importHelloFreshFromPhoto`);
    expect(JSON.parse(init.body)).toEqual({ image: 'QUFB', mediaType: 'image/png' });
  });

  it('passes the poor-photo hints back to the UI', async () => {
    global.fetch.mockResolvedValue(
      errorResponse(422, {
        status: 'error',
        code: 'unreadable-image',
        message: 'That photo was too hard to read.',
        details: ['Glare over the ingredients.'],
      })
    );

    const err = await importFromPhoto({ image: 'QUFB' }).catch((e) => e);

    expect(err.code).toBe('unreadable-image');
    expect(err.details).toEqual(['Glare over the ingredients.']);
  });
});

describe('base64ByteLength', () => {
  it('estimates the decoded size', () => {
    expect(base64ByteLength('AAAA')).toBe(3);
    expect(base64ByteLength('AAA=')).toBe(2);
    expect(base64ByteLength('')).toBe(0);
  });
});

describe('downscaleImage', () => {
  it('returns the original when there is no canvas to resize with', async () => {
    // jsdom has no 2D context, which is also true of locked-down browsers.
    const dataUrl = 'data:image/jpeg;base64,QUFB';
    await expect(downscaleImage(dataUrl)).resolves.toBe(dataUrl);
  });

  it('resizes when a canvas is available and the photo is oversized', async () => {
    const original = `data:image/jpeg;base64,${'A'.repeat(500)}`;
    const smaller = 'data:image/jpeg;base64,SMALL';

    const drawImage = jest.fn();
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return document.createElement.wrappedMethod?.(tag) ?? {};
      return {
        getContext: () => ({ drawImage }),
        toDataURL: () => smaller,
        width: 0,
        height: 0,
      };
    });

    // jsdom never fires load for an <img>, so drive it by hand.
    const imageSpy = jest.spyOn(global, 'Image').mockImplementation(function FakeImage() {
      this.width = 3200;
      this.height = 2400;
      setTimeout(() => this.onload?.(), 0);
    });

    await expect(downscaleImage(original, 1600)).resolves.toBe(smaller);
    expect(drawImage).toHaveBeenCalled();

    imageSpy.mockRestore();
    document.createElement.mockRestore();
  });
});

describe('readImageFile', () => {
  const makeFile = (bytes, type = 'image/jpeg') =>
    new File([new Uint8Array(bytes)], 'card.jpg', { type });

  it('turns a picked photo into a base64 payload', async () => {
    const result = await readImageFile(makeFile(2048));

    expect(result.mediaType).toBe('image/jpeg');
    expect(result.image.length).toBeGreaterThan(0);
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    // The bare payload is sent, not the whole data: URL.
    expect(result.image).not.toMatch(/^data:/);
  });

  it('refuses a file that is not an image we can send', async () => {
    const err = await readImageFile(
      new File(['x'], 'recipe.pdf', { type: 'application/pdf' })
    ).catch((e) => e);

    expect(err).toBeInstanceOf(HelloFreshImportError);
    expect(err.message).toMatch(/JPEG, PNG/i);
  });

  it('asks for a smaller photo when one is too big to send', async () => {
    const err = await readImageFile(makeFile(MAX_IMAGE_BYTES + 4096)).catch((e) => e);

    expect(err.code).toBe('unreadable-image');
    expect(err.message).toMatch(/too large/i);
  });

  it('explains when nothing was selected', async () => {
    await expect(readImageFile(null)).rejects.toMatchObject({ code: 'unreadable-image' });
  });
});
