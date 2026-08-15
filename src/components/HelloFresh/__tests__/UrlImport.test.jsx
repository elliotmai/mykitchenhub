import React from 'react';

import { renderWithProviders, screen, waitFor } from '../../../test-utils';
import UrlImport from '../UrlImport';

const RECIPE_URL = 'https://www.hellofresh.com/recipes/sweet-chili-chicken-123';

const setup = (props = {}) => {
  const onImport = jest.fn().mockResolvedValue({ success: true });
  const onManualEntry = jest.fn();
  const utils = renderWithProviders(
    <UrlImport onImport={onImport} onManualEntry={onManualEntry} {...props} />
  );
  return { ...utils, onImport, onManualEntry };
};

const field = () => screen.getByLabelText(/hellofresh recipe link/i);

it('asks for the link with an example of what one looks like', () => {
  setup();

  expect(screen.getByRole('heading', { name: /paste the recipe link/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/hellofresh\.com\/recipes/i)).toBeInTheDocument();
});

it('imports a HelloFresh link', async () => {
  const { onImport, user } = setup();

  await user.type(field(), RECIPE_URL);
  await user.click(screen.getByRole('button', { name: 'Import' }));

  await waitFor(() => expect(onImport).toHaveBeenCalledWith(RECIPE_URL));
});

it('trims a pasted link before sending it', async () => {
  const { onImport, user } = setup();

  await user.type(field(), `  ${RECIPE_URL}  `);
  await user.click(screen.getByRole('button', { name: 'Import' }));

  await waitFor(() => expect(onImport).toHaveBeenCalledWith(RECIPE_URL));
});

it('will not send a link that is not HelloFresh', async () => {
  const { onImport, user } = setup();

  await user.type(field(), 'https://www.allrecipes.com/recipe/1');
  await user.click(screen.getByRole('button', { name: 'Import' }));

  expect(onImport).not.toHaveBeenCalled();
  expect(await screen.findByText(/needs to be a hellofresh\.com recipe link/i)).toBeInTheDocument();
});

it('does not nag before anything has been typed', () => {
  setup();

  // Bootstrap keeps the feedback node in the DOM and reveals it via is-invalid.
  expect(field()).not.toHaveClass('is-invalid');
});

it('keeps the Import button out of reach until there is something to import', async () => {
  const { user } = setup();

  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();

  await user.type(field(), RECIPE_URL);
  expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
});

it('says what it is doing while the page is read', () => {
  setup({ importing: true });

  expect(screen.getByText(/reading…/i)).toBeInTheDocument();
  expect(field()).toBeDisabled();
});

it('suggests the photo route when a page has no recipe data on it', () => {
  setup({
    error: { code: 'recipe-not-found', message: 'No recipe details were found on that page.' },
  });

  expect(screen.getByText('No recipe details were found on that page.')).toBeInTheDocument();
  expect(screen.getByText(/photographing the card works better/i)).toBeInTheDocument();
});

it('offers the manual fallback for a recipe with no link', async () => {
  const { onManualEntry, user } = setup();

  await user.click(screen.getByRole('button', { name: /no link\? enter it by hand/i }));

  expect(onManualEntry).toHaveBeenCalled();
});
