// useHelloFreshImport — the three ways a recipe gets in, and the write that
// lands it in the shared library.
//
// The Cloud Functions are stubbed at the service boundary, so no test here
// makes a network call or a Claude Vision request.

import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import useHelloFreshImport, {
  emptyDraft,
  normalizeIngredientName,
  toRecipeDocument,
  validateDraft,
} from '../useHelloFreshImport';
import { AuthProvider } from '../useAuth';
import * as api from '../../services/helloFreshApi';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { makeHelloFreshRecipe, makeUserProfile } from '../../test-utils/factories';

jest.mock('../../services/helloFreshApi', () => {
  const actual = jest.requireActual('../../services/helloFreshApi');
  return {
    ...actual,
    importFromPhoto: jest.fn(),
    importFromUrl: jest.fn(),
    readImageFile: jest.fn(),
    isImportConfigured: jest.fn(() => true),
  };
});

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

/** The hook needs a signed-in user before the write path will run. */
const signIn = () => {
  const user = authMock.__user();
  authMock.__setUser(user);
  fs.getDoc.mockResolvedValue(fs.__doc(user.uid, makeUserProfile()));
  return user;
};

const draftFromImport = () => {
  const { id, createdAt, ...recipe } = makeHelloFreshRecipe();
  return recipe;
};

const renderImport = () => renderHook(() => useHelloFreshImport(), { wrapper });

beforeEach(() => {
  signIn();
  api.readImageFile.mockResolvedValue({ image: 'QUFB', mediaType: 'image/jpeg' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('validateDraft', () => {
  const valid = draftFromImport();

  it('accepts a complete recipe', () => {
    expect(validateDraft(valid)).toEqual([]);
  });

  it.each([
    ['a missing name', { name: '  ' }, /name/i],
    ['no ingredients', { ingredients: [] }, /ingredient/i],
    ['no steps', { instructions: [] }, /step/i],
    ['zero servings', { servings: 0 }, /servings/i],
    ['a difficulty the rules reject', { difficulty: 'impossible' }, /difficulty/i],
  ])('rejects %s', (_label, patch, pattern) => {
    const problems = validateDraft({ ...valid, ...patch });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toMatch(pattern);
  });

  it('rejects an ingredient with no quantity', () => {
    const problems = validateDraft({
      ...valid,
      ingredients: [{ name: 'Garlic', quantity: 0, unit: 'clove' }],
    });
    expect(problems.join(' ')).toMatch(/quantity/i);
  });

  it('ignores blank rows the review form leaves behind', () => {
    expect(
      validateDraft({
        ...valid,
        ingredients: [...valid.ingredients, { name: '', quantity: 1, unit: '' }],
        instructions: [...valid.instructions, '   '],
      })
    ).toEqual([]);
  });
});

describe('normalizeIngredientName', () => {
  it("matches the Cloud Function's rule, so inventory lines line up", () => {
    expect(normalizeIngredientName('Tomato Paste (divided)')).toBe('tomato paste');
    expect(normalizeIngredientName('Chicken Breast, boneless')).toBe('chicken breast boneless');
  });
});

describe('toRecipeDocument', () => {
  it('produces every field the recipes rules require, except createdAt', () => {
    const doc = toRecipeDocument(draftFromImport());

    [
      'name',
      'ingredients',
      'instructions',
      'source',
      'tags',
      'servings',
      'difficulty',
      'timesCooked',
    ].forEach((field) => expect(doc).toHaveProperty(field));
    expect(doc.source).toBe('hellofresh');
    expect(doc.timesCooked).toBe(0);
    expect(doc).not.toHaveProperty('createdAt');
  });

  it('drops blank rows and normalises every ingredient', () => {
    const doc = toRecipeDocument({
      ...draftFromImport(),
      ingredients: [
        { name: ' Garlic ', quantity: '2', unit: ' clove ' },
        { name: '', quantity: 1 },
      ],
      instructions: ['Chop.', '   ', ''],
    });

    expect(doc.ingredients).toEqual([
      { name: 'Garlic', quantity: 2, unit: 'clove', normalized: 'garlic' },
    ]);
    expect(doc.instructions).toEqual(['Chop.']);
  });

  it('always keeps the hellofresh tag without duplicating it', () => {
    expect(toRecipeDocument({ ...draftFromImport(), tags: ['chicken'] }).tags).toEqual([
      'chicken',
      'hellofresh',
    ]);
    expect(
      toRecipeDocument({ ...draftFromImport(), tags: ['hellofresh'] }).tags.filter(
        (tag) => tag === 'hellofresh'
      )
    ).toHaveLength(1);
  });
});

describe('emptyDraft', () => {
  it('gives the manual form a starting row of each kind', () => {
    const draft = emptyDraft();
    expect(draft.source).toBe('hellofresh');
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.instructions).toHaveLength(1);
    expect(draft.servings).toBeGreaterThan(0);
  });
});

describe('importPhoto', () => {
  it('reads the file, calls the function, and holds the draft for review', async () => {
    const recipe = draftFromImport();
    api.importFromPhoto.mockResolvedValue({ recipe, warnings: ['Step 3 was cut off.'] });

    const { result } = renderImport();
    const file = new File(['x'], 'card.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await result.current.importPhoto(file);
    });

    expect(api.readImageFile).toHaveBeenCalledWith(file);
    expect(api.importFromPhoto).toHaveBeenCalledWith({ image: 'QUFB', mediaType: 'image/jpeg' });
    expect(result.current.draft).toEqual(recipe);
    expect(result.current.warnings).toEqual(['Step 3 was cut off.']);
    expect(result.current.error).toBeNull();
  });

  it('does not save anything on its own — the cook confirms first', async () => {
    api.importFromPhoto.mockResolvedValue({ recipe: draftFromImport(), warnings: [] });
    const { result } = renderImport();

    await act(async () => {
      await result.current.importPhoto(new File(['x'], 'card.jpg', { type: 'image/jpeg' }));
    });

    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('surfaces an unreadable photo as an error the UI can explain', async () => {
    api.importFromPhoto.mockRejectedValue(
      new api.HelloFreshImportError('unreadable-image', 'Too blurry.', ['Glare on the card.'])
    );

    const { result } = renderImport();
    let outcome;
    await act(async () => {
      outcome = await result.current.importPhoto(new File(['x'], 'c.jpg', { type: 'image/jpeg' }));
    });

    expect(outcome.success).toBe(false);
    expect(result.current.error).toEqual({
      code: 'unreadable-image',
      message: 'Too blurry.',
      details: ['Glare on the card.'],
    });
    expect(result.current.draft).toBeNull();
  });

  it('clears the loading flag even when the import fails', async () => {
    api.importFromPhoto.mockRejectedValue(new Error('boom'));
    const { result } = renderImport();

    await act(async () => {
      await result.current.importPhoto(new File(['x'], 'c.jpg', { type: 'image/jpeg' }));
    });

    expect(result.current.importing).toBe(false);
  });
});

describe('importUrl', () => {
  it('imports a HelloFresh link', async () => {
    const recipe = draftFromImport();
    api.importFromUrl.mockResolvedValue({ recipe, warnings: [] });

    const { result } = renderImport();
    await act(async () => {
      await result.current.importUrl('https://www.hellofresh.com/recipes/x-123');
    });

    expect(api.importFromUrl).toHaveBeenCalledWith('https://www.hellofresh.com/recipes/x-123');
    expect(result.current.draft).toEqual(recipe);
  });

  it('rejects a non-HelloFresh link without calling the function', async () => {
    const { result } = renderImport();

    await act(async () => {
      await result.current.importUrl('https://www.allrecipes.com/recipe/1');
    });

    expect(api.importFromUrl).not.toHaveBeenCalled();
    expect(result.current.error.code).toBe('invalid-url');
  });
});

describe('startManualEntry', () => {
  it('opens a blank draft with no import involved', async () => {
    const { result } = renderImport();

    act(() => result.current.startManualEntry());

    expect(result.current.draft.name).toBe('');
    expect(result.current.draft.source).toBe('hellofresh');
    expect(api.importFromPhoto).not.toHaveBeenCalled();
    expect(api.importFromUrl).not.toHaveBeenCalled();
  });
});

describe('saveDraft', () => {
  it('writes the recipe to the shared library with a server timestamp', async () => {
    const recipe = draftFromImport();
    api.importFromUrl.mockResolvedValue({ recipe, warnings: [] });

    const { result } = renderImport();
    await act(async () => {
      await result.current.importUrl('https://www.hellofresh.com/recipes/x');
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.saveDraft();
    });

    expect(outcome.success).toBe(true);

    const [ref, written] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe('recipes');
    expect(written.source).toBe('hellofresh');
    expect(written.timesCooked).toBe(0);
    expect(written.createdAt).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('refuses a draft the security rules would reject, before writing', async () => {
    const { result } = renderImport();
    act(() => result.current.startManualEntry());

    let outcome;
    await act(async () => {
      outcome = await result.current.saveDraft();
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error.details.length).toBeGreaterThan(0);
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('accepts a draft passed straight in, as the review form does', async () => {
    const { result } = renderImport();

    await act(async () => {
      await result.current.saveDraft(draftFromImport());
    });

    expect(fs.addDoc).toHaveBeenCalledTimes(1);
  });

  it('reports a write failure instead of claiming success', async () => {
    fs.addDoc.mockRejectedValueOnce(new Error('permission denied'));

    const { result } = renderImport();
    let outcome;
    await act(async () => {
      outcome = await result.current.saveDraft(draftFromImport());
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error.code).toBe('save-failed');
    expect(result.current.saving).toBe(false);
  });

  it('will not write when nobody is signed in', async () => {
    authMock.__setUser(null);
    const { result } = renderImport();

    await waitFor(() => expect(result.current.saving).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveDraft(draftFromImport());
    });

    expect(outcome.success).toBe(false);
    expect(fs.addDoc).not.toHaveBeenCalled();
  });
});

describe('reset', () => {
  it('clears the draft, warnings, and error', async () => {
    api.importFromUrl.mockResolvedValue({ recipe: draftFromImport(), warnings: ['check step 2'] });
    const { result } = renderImport();

    await act(async () => {
      await result.current.importUrl('https://www.hellofresh.com/recipes/x');
    });
    act(() => result.current.reset());

    expect(result.current.draft).toBeNull();
    expect(result.current.warnings).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
