import React from 'react';

import { renderWithProviders, screen, waitFor } from '../../../test-utils';
import PhotoImport from '../PhotoImport';

const file = (type = 'image/jpeg') => new File(['x'], 'card.jpg', { type });

const setup = (props = {}) => {
  const onImport = jest.fn().mockResolvedValue({ success: true });
  const onManualEntry = jest.fn();
  const utils = renderWithProviders(
    <PhotoImport onImport={onImport} onManualEntry={onManualEntry} {...props} />
  );
  return { ...utils, onImport, onManualEntry };
};

it('invites the cook to photograph the card', () => {
  setup();

  expect(screen.getByRole('heading', { name: /photograph the recipe card/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /take or choose a photo/i })).toBeInTheDocument();
});

it('opens the camera on a phone rather than only the file browser', () => {
  setup();

  const input = screen.getByTestId('photo-input');
  expect(input).toHaveAttribute('capture', 'environment');
  expect(input.getAttribute('accept')).toContain('image/jpeg');
});

it('sends the chosen photo up for import', async () => {
  const { onImport, user } = setup();

  await user.upload(screen.getByTestId('photo-input'), file());

  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport.mock.calls[0][0].name).toBe('card.jpg');
});

it('shows a preview of what was photographed', async () => {
  const { user } = setup();

  await user.upload(screen.getByTestId('photo-input'), file());

  expect(await screen.findByAltText(/preview of card\.jpg/i)).toBeInTheDocument();
});

it('says what it is doing while the AI reads the card', () => {
  setup({ importing: true });

  expect(screen.getByText(/reading the card/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /reading the card/i })).toBeDisabled();
});

it('turns a poor-quality photo into advice the cook can act on', () => {
  setup({
    error: {
      code: 'unreadable-image',
      message: 'That photo was too hard to read.',
      details: ['Glare over the ingredients panel.'],
    },
  });

  expect(screen.getByText('That photo was too hard to read.')).toBeInTheDocument();
  expect(screen.getByText('Glare over the ingredients panel.')).toBeInTheDocument();
  expect(screen.getByText(/more light/i)).toBeInTheDocument();
  expect(screen.getByText(/fill the frame/i)).toBeInTheDocument();
});

it('points at the by-hand route when AI import is switched off', () => {
  setup({
    error: { code: 'vision-not-configured', message: 'Photo import is switched off.', details: [] },
  });

  expect(screen.getByText(/enter it by hand.*or paste the recipe link/i)).toBeInTheDocument();
});

it('always offers the manual fallback', async () => {
  const { onManualEntry, user } = setup();

  await user.click(screen.getByRole('button', { name: /enter it by hand/i }));

  expect(onManualEntry).toHaveBeenCalled();
});

it('lets a failed photo be retaken', async () => {
  const { user, onImport } = setup();

  await user.upload(screen.getByTestId('photo-input'), file());
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));

  // The button changes to "try another" once there is a preview, and the input
  // is cleared so the same file can be picked again.
  expect(screen.getByRole('button', { name: /try another photo/i })).toBeInTheDocument();

  await user.upload(screen.getByTestId('photo-input'), file());
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
});
