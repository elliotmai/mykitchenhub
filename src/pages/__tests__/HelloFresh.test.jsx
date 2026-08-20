// The HelloFresh page: importing a recipe end to end, and logging a delivery.
//
// The Cloud Functions are stubbed at the service boundary — no test here makes
// a network call or a Claude Vision request.

import React from 'react';

import {
  asDocs,
  makeHelloFreshRecipe,
  makeLocation,
  renderWithProviders,
  screen,
  waitFor,
} from '../../test-utils';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import * as api from '../../services/helloFreshApi';
import HelloFresh from '../HelloFresh';

jest.mock('../../services/helloFreshApi', () => {
  const actual = jest.requireActual('../../services/helloFreshApi');
  return {
    ...actual,
    importFromPhoto: jest.fn(),
    importFromUrl: jest.fn(),
    readImageFile: jest.fn(),
  };
});

const RECIPE_URL = 'https://www.hellofresh.com/recipes/sweet-chili-chicken-123';

const importedRecipe = () => {
  const { id, createdAt, ...recipe } = makeHelloFreshRecipe();
  return recipe;
};

const uid = () => authMock.__user().uid;

const renderPage = () => renderWithProviders(<HelloFresh />, { route: '/hellofresh' });

/** Feed the page's three listeners so it settles out of its loading state. */
const seedListeners = async ({ recipes = [], deliveries = [], locations = [] } = {}) => {
  await waitFor(() => expect(fs.__listenerCount(`users/${uid()}/deliveries`)).toBe(1));

  fs.__emit('recipes', asDocs(recipes));
  fs.__emit(`users/${uid()}/deliveries`, asDocs(deliveries));
  fs.__emit(`users/${uid()}/storageLocations`, asDocs(locations));
};

beforeEach(() => {
  api.readImageFile.mockResolvedValue({ image: 'QUFB', mediaType: 'image/jpeg' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the page itself', () => {
  it('offers all three ways of adding a recipe', async () => {
    renderPage();
    await seedListeners();

    expect(screen.getByRole('heading', { name: 'HelloFresh' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /photo/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /link/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /by hand/i })).toBeInTheDocument();
  });

  it('opens on the photo route', async () => {
    renderPage();
    await seedListeners();

    expect(
      screen.getByRole('heading', { name: /photograph the recipe card/i })
    ).toBeInTheDocument();
  });

  it('switches to the link route', async () => {
    const { user } = renderPage();
    await seedListeners();

    await user.click(screen.getByRole('tab', { name: /link/i }));

    expect(await screen.findByLabelText(/hellofresh recipe link/i)).toBeInTheDocument();
  });

  it('invites a first delivery when the history is empty', async () => {
    renderPage();
    await seedListeners();

    expect(await screen.findByRole('heading', { name: /no deliveries yet/i })).toBeInTheDocument();
  });
});

describe('importing a recipe', () => {
  it('takes a photo through review to saved', async () => {
    api.importFromPhoto.mockResolvedValue({ recipe: importedRecipe(), warnings: [] });

    const { user } = renderPage();
    await seedListeners();

    await user.upload(
      screen.getByTestId('photo-input'),
      new File(['x'], 'card.jpg', { type: 'image/jpeg' })
    );

    // The AI's read lands in the review form rather than being saved outright.
    expect(await screen.findByText(/check this over before saving/i)).toBeInTheDocument();
    expect(fs.addDoc).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    await waitFor(() => expect(fs.addDoc).toHaveBeenCalledTimes(1));
    const [ref, written] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe('recipes');
    expect(written.source).toBe('hellofresh');
    expect(written.name).toBe('Sweet Chili Chicken');
  });

  it('takes a link through review to saved', async () => {
    api.importFromUrl.mockResolvedValue({ recipe: importedRecipe(), warnings: [] });

    const { user } = renderPage();
    await seedListeners();

    await user.click(screen.getByRole('tab', { name: /link/i }));
    await user.type(await screen.findByLabelText(/hellofresh recipe link/i), RECIPE_URL);
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(/check this over before saving/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    await waitFor(() => expect(fs.addDoc).toHaveBeenCalledTimes(1));
    expect(api.importFromUrl).toHaveBeenCalledWith(RECIPE_URL);
  });

  it('confirms the save and clears the form', async () => {
    api.importFromUrl.mockResolvedValue({ recipe: importedRecipe(), warnings: [] });

    const { user } = renderPage();
    await seedListeners();

    await user.click(screen.getByRole('tab', { name: /link/i }));
    await user.type(await screen.findByLabelText(/hellofresh recipe link/i), RECIPE_URL);
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.click(await screen.findByRole('button', { name: /save recipe/i }));

    expect(await screen.findByText(/is in your recipe book/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/check this over before saving/i)).not.toBeInTheDocument()
    );
  });

  it("shows the AI's doubts alongside the draft", async () => {
    api.importFromPhoto.mockResolvedValue({
      recipe: importedRecipe(),
      warnings: ['Step 3 was cut off.'],
    });

    const { user } = renderPage();
    await seedListeners();

    await user.upload(
      screen.getByTestId('photo-input'),
      new File(['x'], 'card.jpg', { type: 'image/jpeg' })
    );

    expect(await screen.findByText('Step 3 was cut off.')).toBeInTheDocument();
  });

  it('explains an unreadable photo instead of failing silently', async () => {
    api.importFromPhoto.mockRejectedValue(
      new api.HelloFreshImportError('unreadable-image', 'That photo was too hard to read.', [])
    );

    const { user } = renderPage();
    await seedListeners();

    await user.upload(
      screen.getByTestId('photo-input'),
      new File(['x'], 'card.jpg', { type: 'image/jpeg' })
    );

    expect(await screen.findByText('That photo was too hard to read.')).toBeInTheDocument();
    expect(screen.queryByText(/check this over before saving/i)).not.toBeInTheDocument();
  });

  it('falls back to typing the recipe in by hand', async () => {
    const { user } = renderPage();
    await seedListeners();

    await user.click(screen.getByRole('tab', { name: /by hand/i }));
    await user.click(await screen.findByRole('button', { name: /start a blank recipe/i }));

    expect(await screen.findByText(/check this over before saving/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/recipe name/i)).toHaveValue('');
  });

  it('lets a review be abandoned', async () => {
    api.importFromPhoto.mockResolvedValue({ recipe: importedRecipe(), warnings: [] });

    const { user } = renderPage();
    await seedListeners();

    await user.upload(
      screen.getByTestId('photo-input'),
      new File(['x'], 'card.jpg', { type: 'image/jpeg' })
    );
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByText(/check this over before saving/i)).not.toBeInTheDocument()
    );
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('counts what has been imported so far', async () => {
    renderPage();
    await seedListeners({ recipes: [makeHelloFreshRecipe(), makeHelloFreshRecipe()] });

    expect(await screen.findByText(/2 hellofresh recipes imported so far/i)).toBeInTheDocument();
  });
});

describe('logging a delivery', () => {
  const locations = [
    makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' }),
    makeLocation({ id: 'loc-pantry', label: 'Pantry', type: 'pantry', isDefault: false }),
  ];

  it('writes the box out across inventory, meal plan, and history', async () => {
    const { user } = renderPage();
    await seedListeners({
      recipes: [makeHelloFreshRecipe({ id: 'r1', name: 'Sweet Chili Chicken' })],
      locations,
    });

    await user.click(screen.getByRole('button', { name: /add delivery/i }));
    await user.click(await screen.findByRole('checkbox', { name: /sweet chili chicken/i }));

    const modal = screen.getByRole('dialog');
    await user.click(
      Array.from(modal.querySelectorAll('button')).find((button) =>
        /add delivery/i.test(button.textContent)
      )
    );

    await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());

    const paths = fs.addDoc.mock.calls.map(([ref]) => fs.pathOf(ref));
    expect(paths).toContain(`users/${uid()}/deliveries`);
    expect(paths).toContain(`users/${uid()}/inventory`);
    expect(paths).toContain(`users/${uid()}/mealPlanEntries`);
    // And the schedule is remembered for the next box.
    expect(fs.pathOf(fs.updateDoc.mock.calls[0][0])).toBe(`users/${uid()}`);
  });

  it('confirms what was stored and scheduled', async () => {
    const { user } = renderPage();
    await seedListeners({
      recipes: [makeHelloFreshRecipe({ id: 'r1', name: 'Sweet Chili Chicken' })],
      locations,
    });

    await user.click(screen.getByRole('button', { name: /add delivery/i }));
    await user.click(await screen.findByRole('checkbox', { name: /sweet chili chicken/i }));

    const modal = screen.getByRole('dialog');
    await user.click(
      Array.from(modal.querySelectorAll('button')).find((button) =>
        /add delivery/i.test(button.textContent)
      )
    );

    expect(await screen.findByText(/delivery logged/i)).toBeInTheDocument();
  });

  it('shows the deliveries already logged', async () => {
    renderPage();
    await seedListeners({
      deliveries: [
        {
          id: 'd1',
          deliveredAt: new Date(2026, 7, 14),
          mealCount: 3,
          itemsAdded: 12,
          status: 'received',
          recipeNames: ['Sweet Chili Chicken'],
        },
      ],
    });

    expect(await screen.findByText(/3 meals/i)).toBeInTheDocument();
    expect(screen.getByText(/12 ingredients added/i)).toBeInTheDocument();
  });

  it('asks before removing a delivery from the history', async () => {
    const { user } = renderPage();
    await seedListeners({
      deliveries: [
        {
          id: 'd1',
          deliveredAt: new Date(2026, 7, 14),
          mealCount: 1,
          itemsAdded: 2,
          status: 'received',
          recipeNames: [],
        },
      ],
    });

    await user.click(await screen.findByRole('button', { name: /remove delivery from/i }));

    expect(
      await screen.findByText(/ingredients already in your kitchen.*stay put/i)
    ).toBeInTheDocument();
    expect(fs.deleteDoc).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^remove$/i }));

    await waitFor(() =>
      expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe(`users/${uid()}/deliveries/d1`)
    );
  });

  it('edits a delivery already in the history', async () => {
    const { user } = renderPage();
    await seedListeners({
      deliveries: [
        {
          id: 'd1',
          deliveredAt: new Date(2026, 7, 14),
          weekOf: '2026-08-10',
          mealCount: 1,
          itemsAdded: 2,
          status: 'received',
          recipeNames: [],
          notes: '',
        },
      ],
    });

    await user.click(await screen.findByRole('button', { name: /edit delivery from/i }));
    await user.selectOptions(await screen.findByLabelText(/status/i), 'cooked');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(fs.pathOf(fs.updateDoc.mock.calls.at(-1)[0])).toBe(`users/${uid()}/deliveries/d1`)
    );
    expect(fs.updateDoc.mock.calls.at(-1)[1]).toMatchObject({ status: 'cooked' });
    // The counts describe what the import put in the kitchen — an edit must
    // not be able to talk them out of agreeing with the inventory.
    expect(fs.updateDoc.mock.calls.at(-1)[1]).not.toHaveProperty('mealCount');
    expect(fs.updateDoc.mock.calls.at(-1)[1]).not.toHaveProperty('itemsAdded');
    expect(await screen.findByText(/delivery updated/i)).toBeInTheDocument();
  });

  it('says so when an edit is refused, and keeps the dialog open', async () => {
    const { user } = renderPage();
    await seedListeners({
      deliveries: [
        {
          id: 'd1',
          deliveredAt: new Date(2026, 7, 14),
          mealCount: 1,
          itemsAdded: 2,
          status: 'received',
          recipeNames: [],
        },
      ],
    });
    fs.updateDoc.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'unavailable' }));

    await user.click(await screen.findByRole('button', { name: /edit delivery from/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/offline|connection|try again/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
  });

  it('surfaces a failure to load the history', async () => {
    renderPage();
    await waitFor(() => expect(fs.__listenerCount(`users/${uid()}/deliveries`)).toBe(1));

    fs.__emitError(`users/${uid()}/deliveries`);

    expect(await screen.findByText(/couldn.t load your delivery history/i)).toBeInTheDocument();
  });
});
