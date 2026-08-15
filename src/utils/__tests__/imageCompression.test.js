// src/utils/__tests__/imageCompression.test.js
//
// jsdom has no real canvas, which is itself one of the cases under test: the
// module must hand the original file back rather than fail. The compressing
// path is exercised by standing a canvas double in front of it.

import {
  compressImage,
  isCompressible,
  withJpegExtension,
  MIN_COMPRESSIBLE_BYTES,
  COMPRESSIBLE_TYPES,
} from '../imageCompression';

/** A File of a given size and type, without allocating the bytes. */
const makeFile = ({ name = 'photo.jpg', type = 'image/jpeg', size = 4 * 1024 * 1024 } = {}) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

/**
 * Installs a canvas that "encodes" to a blob of `outputSize` bytes and an
 * Image that decodes to `width` x `height`.
 */
const installCanvas = ({ width = 4000, height = 3000, outputSize = 300 * 1024 } = {}) => {
  // `paintOrder` records the calls that put pixels on the surface, because for
  // a transparent source *when* the white fill happens matters as much as
  // whether it happens: filling after the draw would erase the photo.
  const paintOrder = [];
  const context = {
    fillStyle: '',
    fillRect: jest.fn(function fillRect(...args) {
      paintOrder.push({ call: 'fillRect', fillStyle: this.fillStyle, args });
    }),
    drawImage: jest.fn(() => paintOrder.push({ call: 'drawImage' })),
  };

  const canvas = {
    width: 0,
    height: 0,
    paintOrder,
    context,
    getContext: () => context,
    // Blob.size is a getter-only accessor, so it has to be redefined rather
    // than assigned — assigning throws, which the module would then swallow.
    toBlob: (cb) => {
      const blob = new Blob(['y']);
      Object.defineProperty(blob, 'size', { value: outputSize });
      cb(blob);
    },
  };

  const realCreateElement = document.createElement.bind(document);
  jest
    .spyOn(document, 'createElement')
    .mockImplementation((tag) => (tag === 'canvas' ? canvas : realCreateElement(tag)));

  global.URL.createObjectURL = jest.fn(() => 'blob:fake');
  global.URL.revokeObjectURL = jest.fn();

  // jsdom's Image never fires load for a blob: URL, so drive it by hand.
  Object.defineProperty(global.Image.prototype, 'src', {
    configurable: true,
    set() {
      Object.defineProperty(this, 'width', { value: width, configurable: true });
      Object.defineProperty(this, 'height', { value: height, configurable: true });
      setTimeout(() => this.onload?.(), 0);
    },
  });

  return canvas;
};

afterEach(() => {
  jest.restoreAllMocks();
  delete global.Image.prototype.src;
});

describe('isCompressible', () => {
  it.each(COMPRESSIBLE_TYPES)('accepts %s above the size floor', (type) => {
    expect(isCompressible(makeFile({ type }))).toBe(true);
  });

  it('leaves HEIC alone — a canvas cannot decode one, and would upload a blank', () => {
    expect(isCompressible(makeFile({ type: 'image/heic' }))).toBe(false);
  });

  it('leaves a photo that is already small alone', () => {
    expect(isCompressible(makeFile({ size: MIN_COMPRESSIBLE_BYTES - 1 }))).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(isCompressible(null)).toBe(false);
    expect(isCompressible(undefined)).toBe(false);
  });
});

describe('withJpegExtension', () => {
  it.each([
    ['fridge.heic', 'fridge.jpg'],
    ['a.b.png', 'a.b.jpg'],
    ['noextension', 'noextension.jpg'],
  ])('renames %s to %s', (input, expected) => {
    expect(withJpegExtension(input)).toBe(expected);
  });
});

describe('compressImage', () => {
  it('returns a smaller JPEG for an oversized phone photo', async () => {
    const canvas = installCanvas({ width: 4000, height: 3000, outputSize: 300 * 1024 });
    const original = makeFile({ size: 4 * 1024 * 1024 });

    const result = await compressImage(original);

    expect(result).not.toBe(original);
    expect(result.size).toBeLessThan(original.size);
    expect(result.type).toBe('image/jpeg');
    // Scaled to the 1600px cap, keeping the 4:3 aspect ratio.
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
  });

  it('never enlarges a photo that is already under the edge cap', async () => {
    const canvas = installCanvas({ width: 900, height: 600, outputSize: 100 * 1024 });

    await compressImage(makeFile({ size: 3 * 1024 * 1024 }));

    expect(canvas.width).toBe(900);
    expect(canvas.height).toBe(600);
  });

  it('renames the result so the stored name matches the stored bytes', async () => {
    installCanvas({ outputSize: 100 * 1024 });

    const result = await compressImage(makeFile({ name: 'dinner.png', type: 'image/png' }));

    expect(result.name).toBe('dinner.jpg');
  });

  it('keeps the original when the re-encode came out no smaller', async () => {
    installCanvas({ outputSize: 9 * 1024 * 1024 });
    const original = makeFile({ size: 1 * 1024 * 1024 });

    expect(await compressImage(original)).toBe(original);
  });

  it('keeps the original where there is no canvas at all', async () => {
    const original = makeFile();
    // No installCanvas: jsdom's canvas has no getContext('2d').
    expect(await compressImage(original)).toBe(original);
  });

  it('keeps the original when the photo will not decode', async () => {
    installCanvas();
    Object.defineProperty(global.Image.prototype, 'src', {
      configurable: true,
      set() {
        setTimeout(() => this.onerror?.(new Error('bad image')), 0);
      },
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const original = makeFile();
    expect(await compressImage(original)).toBe(original);
  });

  it('never rejects, whatever goes wrong — an unshrunk photo beats no photo', async () => {
    jest.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('canvas is disabled');
    });

    const original = makeFile();
    await expect(compressImage(original)).resolves.toBe(original);
  });

  // -------------------------------------------------------------------------
  // Transparency
  //
  // JPEG cannot store an alpha channel, so whatever is behind a transparent
  // pixel at encode time is what gets stored. A fresh canvas is transparent
  // *black*, which meant a PNG with any cut-out in it came back with the
  // cut-out filled in black.
  // -------------------------------------------------------------------------
  it('lays white under a transparent PNG, so a cut-out does not encode as black', async () => {
    const canvas = installCanvas({ width: 1200, height: 800, outputSize: 100 * 1024 });

    await compressImage(makeFile({ name: 'logo.png', type: 'image/png' }));

    const [first] = canvas.paintOrder;
    expect(first.call).toBe('fillRect');
    expect(first.fillStyle).toBe('#ffffff');
    // The whole surface, not a corner of it.
    expect(first.args).toEqual([0, 0, canvas.width, canvas.height]);
  });

  it('paints that white before the photo, not over the top of it', async () => {
    const canvas = installCanvas({ outputSize: 100 * 1024 });

    await compressImage(makeFile({ type: 'image/png' }));

    expect(canvas.paintOrder.map((p) => p.call)).toEqual(['fillRect', 'drawImage']);
  });

  it('covers the scaled surface, not the original photo size', async () => {
    const canvas = installCanvas({ width: 4000, height: 2000, outputSize: 100 * 1024 });

    await compressImage(makeFile({ type: 'image/png' }));

    // 4000x2000 scaled to the 1600px cap.
    expect(canvas.paintOrder[0].args).toEqual([0, 0, 1600, 800]);
  });

  // -------------------------------------------------------------------------
  // The edges of "is this even a photo"
  // -------------------------------------------------------------------------
  it('hands back a file that is not really an image, rather than a broken one', async () => {
    // A PDF the picker let through as image/jpeg: big enough to be worth
    // compressing, but nothing a canvas can decode.
    installCanvas();
    Object.defineProperty(global.Image.prototype, 'src', {
      configurable: true,
      set() {
        setTimeout(() => this.onerror?.(new Error('not an image')), 0);
      },
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const notAPhoto = makeFile({ name: 'invoice.pdf.jpg', size: 2 * 1024 * 1024 });

    expect(await compressImage(notAPhoto)).toBe(notAPhoto);
  });

  it('leaves a tiny photo untouched rather than re-encoding it larger', async () => {
    const canvas = installCanvas();
    const tiny = makeFile({ size: 4 * 1024 });

    expect(await compressImage(tiny)).toBe(tiny);
    // Never even decoded — the size floor short-circuits before the canvas.
    expect(canvas.paintOrder).toEqual([]);
  });

  it('survives a photo whose longest edge rounds below one pixel', async () => {
    // A 1x1 tracking pixel padded to 2MB. Scaling must never produce a
    // zero-width canvas, which throws on drawImage in a real browser.
    const canvas = installCanvas({ width: 1, height: 1, outputSize: 100 * 1024 });

    await compressImage(makeFile({ size: 2 * 1024 * 1024 }));

    expect(canvas.width).toBeGreaterThanOrEqual(1);
    expect(canvas.height).toBeGreaterThanOrEqual(1);
  });
});
