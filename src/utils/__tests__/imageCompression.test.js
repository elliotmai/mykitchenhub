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
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: jest.fn() }),
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
});
