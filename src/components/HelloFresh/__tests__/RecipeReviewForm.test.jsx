// The review step, which is also the manual-entry form. Its job is to let a
// cook fix what the AI got wrong, and to refuse anything the `recipes` security
// rules would bounce.

import React from 'react';

import { renderWithProviders, screen, waitFor, within } from '../../../test-utils';
import RecipeReviewForm from '../RecipeReviewForm';
import { emptyDraft } from '../../../hooks/useHelloFreshImport';

const draft = (overrides = {}) => ({
  name: 'Sweet Chili Chicken',
  ingredients: [
    { name: 'Chicken Breast', quantity: 2, unit: 'unit' },
    { name: 'Tomato Paste', quantity: 28, unit: 'g' },
  ],
  instructions: ['Preheat the oven to 425F.', 'Roast for 20 minutes.'],
  source: 'hellofresh',
  tags: ['hellofresh', 'chicken'],
  prepTime: 10,
  cookTime: 25,
  servings: 2,
  difficulty: 'medium',
  timesCooked: 0,
  imageUrl: null,
  sourceUrl: null,
  ...overrides,
});

const setup = (props = {}) => {
  const onSave = jest.fn().mockResolvedValue({ success: true });
  const onCancel = jest.fn();
  const utils = renderWithProviders(
    <RecipeReviewForm draft={draft()} onSave={onSave} onCancel={onCancel} {...props} />
  );
  return { ...utils, onSave, onCancel };
};

it('renders nothing when there is no draft to review', () => {
  renderWithProviders(<RecipeReviewForm draft={null} onSave={jest.fn()} onCancel={jest.fn()} />);

  expect(screen.queryByLabelText(/recipe name/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /save recipe/i })).not.toBeInTheDocument();
});

it('shows what the AI read, ready to correct', () => {
  setup();

  expect(screen.getByLabelText(/recipe name/i)).toHaveValue('Sweet Chili Chicken');
  expect(screen.getByLabelText('Ingredient', { selector: '#ingredient-name-0' })).toHaveValue(
    'Chicken Breast'
  );
  expect(screen.getByLabelText('Step 1')).toHaveValue('Preheat the oven to 425F.');
  expect(screen.getByLabelText(/servings/i)).toHaveValue(2);
  expect(screen.getByLabelText(/difficulty/i)).toHaveValue('medium');
});

it('flags what the AI was unsure about', () => {
  setup({ warnings: ['Step 3 was cut off at the edge of the photo.'] });

  expect(screen.getByText(/double-check/i)).toBeInTheDocument();
  expect(screen.getByText('Step 3 was cut off at the edge of the photo.')).toBeInTheDocument();
});

it('saves the corrected recipe', async () => {
  const { onSave, user } = setup();

  const nameField = screen.getByLabelText(/recipe name/i);
  await user.clear(nameField);
  await user.type(nameField, 'Sweet Chilli Chicken');
  await user.click(screen.getByRole('button', { name: /save recipe/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].name).toBe('Sweet Chilli Chicken');
});

it('lets an ingredient be corrected', async () => {
  const { onSave, user } = setup();

  const qty = screen.getByLabelText('Qty', { selector: '#ingredient-qty-1' });
  await user.clear(qty);
  await user.type(qty, '56');
  await user.click(screen.getByRole('button', { name: /save recipe/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].ingredients[1].quantity).toBe(56);
});

it('lets a missed ingredient be added', async () => {
  const { onSave, user } = setup();

  await user.click(screen.getByRole('button', { name: /add ingredient/i }));
  await user.type(screen.getByLabelText('Ingredient', { selector: '#ingredient-name-2' }), 'Lime');
  await user.click(screen.getByRole('button', { name: /save recipe/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].ingredients).toHaveLength(3);
});

it('lets a misread ingredient be removed', async () => {
  const { onSave, user } = setup();

  await user.click(screen.getByRole('button', { name: /remove ingredient 1/i }));
  await user.click(screen.getByRole('button', { name: /save recipe/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].ingredients).toEqual([
    { name: 'Tomato Paste', quantity: 28, unit: 'g' },
  ]);
});

it('lets steps be added and removed', async () => {
  const { onSave, user } = setup();

  await user.click(screen.getByRole('button', { name: /add step/i }));
  await user.type(screen.getByLabelText('Step 3'), 'Rest 5 minutes.');
  await user.click(screen.getByRole('button', { name: /remove step 1/i }));
  await user.click(screen.getByRole('button', { name: /save recipe/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].instructions).toEqual([
    'Roast for 20 minutes.',
    'Rest 5 minutes.',
  ]);
});

it('edits tags as plain comma-separated text', async () => {
  const { onSave, user } = setup();

  const tags = screen.getByLabelText(/^tags$/i);
  await user.clear(tags);
  await user.type(tags, 'chicken, one-pan');
  await user.click(screen.getByRole('button', { name: /save recipe/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].tags).toEqual(['chicken', 'one-pan']);
});

it('refuses to save a recipe the security rules would reject', async () => {
  const { onSave, user } = setup({ draft: emptyDraft() });

  await user.click(screen.getByRole('button', { name: /save recipe/i }));

  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByText(/give the recipe a name/i)).toBeInTheDocument();
  expect(screen.getByText(/add at least one ingredient/i)).toBeInTheDocument();
  expect(screen.getByText(/add at least one cooking step/i)).toBeInTheDocument();
});

it('does not scold before the cook has tried to save', () => {
  setup({ draft: emptyDraft() });

  expect(screen.queryByText(/give the recipe a name/i)).not.toBeInTheDocument();
});

it('surfaces a failed save', () => {
  setup({ error: { code: 'save-failed', message: 'That recipe could not be saved.' } });

  expect(screen.getByText('That recipe could not be saved.')).toBeInTheDocument();
});

it('says what it is doing while saving', () => {
  setup({ saving: true });

  expect(screen.getByText(/saving…/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /saving…/i })).toBeDisabled();
});

it.each(['Cancel', 'Close review'])('can be abandoned via %s', async (label) => {
  const { onCancel, user } = setup();

  await user.click(screen.getByRole('button', { name: label }));

  expect(onCancel).toHaveBeenCalled();
});

it('replaces what is on screen when a new import arrives', () => {
  const { rerender } = setup();

  rerender(
    <RecipeReviewForm
      draft={draft({ name: 'Sheet Pan Salmon' })}
      onSave={jest.fn()}
      onCancel={jest.fn()}
    />
  );

  expect(screen.getByLabelText(/recipe name/i)).toHaveValue('Sheet Pan Salmon');
});

it('offers only the difficulties the rules allow', () => {
  setup();

  const options = within(screen.getByLabelText(/difficulty/i)).getAllByRole('option');
  expect(options.map((option) => option.value)).toEqual(['easy', 'medium', 'hard']);
});
