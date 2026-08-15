// Add / edit a recipe.
//
// The behaviour worth guarding here is the one that looks like a bug: the name
// is read-only when editing, and the save payload leaves it out entirely.
// firestore.rules rejects any update that carries `name`, so a form that let a
// cook retype it would just bounce.

import React from 'react';
import { renderWithProviders, screen, waitFor, userEvent, makeRecipe } from '../../../test-utils';
import * as storage from '../../../test-utils/mocks/storage';
import AddRecipeModal from '../AddRecipeModal';

const setup = (props = {}) => {
  const onSave = props.onSave ?? jest.fn(async () => ({ success: true }));
  const onHide = props.onHide ?? jest.fn();

  return {
    onSave,
    onHide,
    ...renderWithProviders(
      <AddRecipeModal show onHide={onHide} onSave={onSave} {...props} onSaveOverride={undefined} />
    ),
  };
};

/** Fill the minimum a new recipe needs. */
const fillNewRecipe = async (user, { name = 'Sheet Pan Salmon' } = {}) => {
  await user.type(screen.getByPlaceholderText(/Sheet Pan Salmon/), name);
  await user.type(screen.getByLabelText('Ingredient 1 name'), 'salmon');
  await user.type(screen.getByLabelText('Step 1'), 'Roast for 15 minutes.');
};

const submit = (user) => user.click(screen.getByRole('button', { name: 'Add Recipe' }));

describe('AddRecipeModal — adding', () => {
  it('titles itself for adding', () => {
    setup();

    // react-bootstrap's Modal.Title is a styled div, not a heading element.
    expect(screen.getByText('Add Recipe', { selector: '.modal-title' })).toBeInTheDocument();
  });

  it('saves the recipe a cook typed', async () => {
    const { user, onSave } = setup();

    await fillNewRecipe(user);
    await submit(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'Sheet Pan Salmon',
      ingredients: [expect.objectContaining({ name: 'salmon' })],
      instructions: ['Roast for 15 minutes.'],
    });
  });

  it('sends the servings and difficulty the rules require', async () => {
    const { user, onSave } = setup();

    await fillNewRecipe(user);
    await user.clear(screen.getByLabelText('Servings'));
    await user.type(screen.getByLabelText('Servings'), '6');
    await user.selectOptions(screen.getByLabelText('Difficulty'), 'hard');
    await submit(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ servings: 6, difficulty: 'hard' });
  });

  it('closes on a successful save', async () => {
    const { user, onHide } = setup();

    await fillNewRecipe(user);
    await submit(user);

    await waitFor(() => expect(onHide).toHaveBeenCalled());
  });

  it('shows what went wrong and stays open on a failed save', async () => {
    const onSave = jest.fn(async () => ({ success: false, error: 'Add at least one ingredient.' }));
    const { user, onHide } = setup({ onSave });

    await fillNewRecipe(user);
    await submit(user);

    expect(await screen.findByText('Add at least one ingredient.')).toBeInTheDocument();
    expect(onHide).not.toHaveBeenCalled();
  });

  describe('tags', () => {
    it('adds a tag on Enter', async () => {
      const { user, onSave } = setup();

      await fillNewRecipe(user);
      await user.type(screen.getByLabelText('Add a tag'), 'dinner{Enter}');
      await submit(user);

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].tags).toContain('dinner');
    });

    it('adds a tag on a comma, so a cook can type a list', async () => {
      const { user, onSave } = setup();

      await fillNewRecipe(user);
      await user.type(screen.getByLabelText('Add a tag'), 'dinner,quick,');
      await submit(user);

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].tags).toEqual(expect.arrayContaining(['dinner', 'quick']));
    });

    it('keeps a tag still sitting in the box when the cook saves', async () => {
      const { user, onSave } = setup();

      await fillNewRecipe(user);
      await user.type(screen.getByLabelText('Add a tag'), 'weeknight');
      await submit(user);

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].tags).toContain('weeknight');
    });

    it('removes a tag chip', async () => {
      const { user, onSave } = setup();

      await fillNewRecipe(user);
      await user.type(screen.getByLabelText('Add a tag'), 'dinner{Enter}');
      await user.click(screen.getByRole('button', { name: 'Remove tag dinner' }));
      await submit(user);

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].tags).not.toContain('dinner');
    });
  });

  describe('photo', () => {
    const jpeg = () => new File(['x'], 'salmon.jpg', { type: 'image/jpeg' });

    it('uploads the chosen photo and saves its URL', async () => {
      const { user, onSave } = setup();

      await fillNewRecipe(user);
      await user.upload(screen.getByLabelText('Recipe photo'), jpeg());

      await waitFor(() => expect(storage.uploadBytes).toHaveBeenCalled());
      await submit(user);

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].imageUrl).toMatch(/^https:\/\/storage\.test\/recipes\//);
    });

    it('refuses a file the storage rules would reject, and says why', async () => {
      setup();

      // The input's `accept` normally filters this out at the picker; a cook
      // who switches the picker to "All files" gets past it, which is what the
      // client-side guard is for. applyAccept: false reproduces that.
      const picker = userEvent.setup({ applyAccept: false });
      await picker.upload(
        screen.getByLabelText('Recipe photo'),
        new File(['x'], 'notes.txt', { type: 'text/plain' })
      );

      expect(await screen.findByText(/not supported/i)).toBeInTheDocument();
      expect(storage.uploadBytes).not.toHaveBeenCalled();
    });

    it('refuses a photo over the 10MB storage limit', async () => {
      setup();

      const huge = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
      Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 });

      const user = userEvent.setup();
      await user.upload(screen.getByLabelText('Recipe photo'), huge);

      expect(await screen.findByText(/larger than 10MB/i)).toBeInTheDocument();
      expect(storage.uploadBytes).not.toHaveBeenCalled();
    });

    it('lets a cook take the photo back off', async () => {
      const { user, onSave } = setup();

      await fillNewRecipe(user);
      await user.upload(screen.getByLabelText('Recipe photo'), jpeg());
      await waitFor(() => expect(screen.getByAltText('Recipe preview')).toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: /remove photo/i }));
      await submit(user);

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].imageUrl).toBeNull();
    });
  });
});

describe('AddRecipeModal — editing', () => {
  const existing = makeRecipe({
    id: 'r1',
    name: 'Sheet Pan Salmon',
    servings: 2,
    difficulty: 'easy',
    tags: ['dinner'],
    ingredients: [{ name: 'salmon', quantity: 2, unit: 'piece', normalized: 'salmon' }],
    instructions: ['Roast for 15 minutes.'],
  });

  it('titles itself for editing and pre-fills the recipe', () => {
    setup({ editRecipe: existing });

    expect(screen.getByText('Edit Recipe', { selector: '.modal-title' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Sheet Pan Salmon/)).toHaveValue('Sheet Pan Salmon');
    expect(screen.getByLabelText('Ingredient 1 name')).toHaveValue('salmon');
    expect(screen.getByLabelText('Step 1')).toHaveValue('Roast for 15 minutes.');
  });

  it('locks the name and explains why, rather than letting the save bounce', () => {
    setup({ editRecipe: existing });

    expect(screen.getByPlaceholderText(/Sheet Pan Salmon/)).toBeDisabled();
    expect(screen.getByText(/names stay fixed once saved/i)).toBeInTheDocument();
  });

  it('leaves the name out of the patch entirely', async () => {
    const { user, onSave } = setup({ editRecipe: existing });

    await user.clear(screen.getByLabelText('Servings'));
    await user.type(screen.getByLabelText('Servings'), '4');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('name');
    expect(onSave.mock.calls[0][0].servings).toBe(4);
  });

  it('keeps the existing tags', async () => {
    const { user, onSave } = setup({ editRecipe: existing });

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].tags).toContain('dinner');
  });
});
