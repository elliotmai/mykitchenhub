// Recipe photo upload. The limits here mirror firestore/storage.rules — a file
// the rules would reject has to be caught before the upload, because the
// rejection comes back as an opaque "unauthorized".

import { renderHook, act } from '@testing-library/react';

import useRecipeImageUpload, {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  safeFileName,
  draftRecipeId,
  validateImage,
} from '../useRecipeImageUpload';
import * as storage from '../../test-utils/mocks/storage';
import { expectHumanError } from '../../test-utils/humanErrors';

/** A File-alike, since jsdom's File constructor cannot fake a large size. */
const makeFile = ({ name = 'salmon.jpg', type = 'image/jpeg', size = 1024 } = {}) => ({
  name,
  type,
  size,
});

describe('storage rule mirrors', () => {
  it('accepts exactly the content types storage.rules allows', () => {
    expect(ALLOWED_IMAGE_TYPES).toEqual([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);
  });

  it('caps uploads at the rules 10MB ceiling', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('safeFileName', () => {
  it('keeps an ordinary name', () => {
    expect(safeFileName('salmon.jpg')).toBe('salmon.jpg');
  });

  it('replaces characters that would confuse a storage path', () => {
    expect(safeFileName('my recipe/photo?.jpg')).toBe('my-recipe-photo-.jpg');
  });

  it('falls back to a default for an unusable name', () => {
    expect(safeFileName('')).toBe('photo.jpg');
    expect(safeFileName(undefined)).toBe('photo.jpg');
  });
});

describe('draftRecipeId', () => {
  it('is unique per call, so two drafts never share a folder', () => {
    expect(draftRecipeId()).not.toBe(draftRecipeId());
  });
});

describe('validateImage', () => {
  it('accepts a normal photo', () => {
    expect(validateImage(makeFile())).toBeNull();
  });

  it('asks for a file when none was chosen', () => {
    expect(validateImage(null)).toMatch(/choose a photo/i);
  });

  it('names the formats that work, rather than just refusing', () => {
    expect(validateImage(makeFile({ type: 'application/pdf' }))).toMatch(/JPEG, PNG, WebP or HEIC/);
  });

  it('rejects a file over the 10MB rule', () => {
    expect(validateImage(makeFile({ size: MAX_IMAGE_BYTES + 1 }))).toMatch(/10MB/);
  });

  it('accepts a file exactly at the limit', () => {
    expect(validateImage(makeFile({ size: MAX_IMAGE_BYTES }))).toBeNull();
  });
});

describe('useRecipeImageUpload.upload', () => {
  it('uploads under recipes/{id}/ and returns the download URL', async () => {
    const { result } = renderHook(() => useRecipeImageUpload());

    let response;
    await act(async () => {
      response = await result.current.upload(makeFile(), { recipeId: 'r1' });
    });

    expect(response.success).toBe(true);
    expect(response.path).toBe('recipes/r1/salmon.jpg');
    expect(response.url).toBe('https://storage.test/recipes/r1/salmon.jpg');
  });

  it('mints a draft folder when the recipe does not exist yet', async () => {
    const { result } = renderHook(() => useRecipeImageUpload());

    let response;
    await act(async () => {
      response = await result.current.upload(makeFile());
    });

    expect(response.path).toMatch(/^recipes\/draft-[^/]+\/salmon\.jpg$/);
  });

  it('sends the content type through, which the rules check', async () => {
    const { result } = renderHook(() => useRecipeImageUpload());

    await act(async () => {
      await result.current.upload(makeFile({ type: 'image/png', name: 'a.png' }));
    });

    const [, , metadata] = storage.uploadBytes.mock.calls[0];
    expect(metadata).toEqual({ contentType: 'image/png' });
  });

  it('refuses an unsupported file without contacting storage', async () => {
    const { result } = renderHook(() => useRecipeImageUpload());

    let response;
    await act(async () => {
      response = await result.current.upload(makeFile({ type: 'text/plain' }));
    });

    expect(response.success).toBe(false);
    expect(storage.uploadBytes).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/not supported/i);
  });

  it('reports a failed upload in words a cook can act on', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    storage.uploadBytes.mockRejectedValueOnce(new Error('storage/unauthorized'));

    const { result } = renderHook(() => useRecipeImageUpload());

    let response;
    await act(async () => {
      response = await result.current.upload(makeFile());
    });

    expect(response.success).toBe(false);
    expectHumanError(response.error, /photo/i);
    expect(result.current.uploading).toBe(false);
  });

  it('clears an earlier error on reset', async () => {
    const { result } = renderHook(() => useRecipeImageUpload());

    await act(async () => {
      await result.current.upload(makeFile({ type: 'text/plain' }));
    });
    expect(result.current.error).toBeTruthy();

    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });
});

describe('useRecipeImageUpload.remove', () => {
  it('deletes the object at the given path', async () => {
    const { result } = renderHook(() => useRecipeImageUpload());

    let response;
    await act(async () => {
      response = await result.current.remove('recipes/r1/salmon.jpg');
    });

    expect(response.success).toBe(true);
    expect(storage.deleteObject).toHaveBeenCalled();
  });

  it('does nothing without a path', async () => {
    const { result } = renderHook(() => useRecipeImageUpload());

    let response;
    await act(async () => {
      response = await result.current.remove('');
    });

    expect(response.success).toBe(false);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('treats a failed cleanup as untidy, not broken', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    storage.deleteObject.mockRejectedValueOnce(new Error('not found'));

    const { result } = renderHook(() => useRecipeImageUpload());

    let response;
    await act(async () => {
      response = await result.current.remove('recipes/r1/gone.jpg');
    });

    expect(response.success).toBe(false);
  });
});
