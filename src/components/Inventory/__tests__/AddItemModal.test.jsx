// The add/edit form. The interesting behaviour is the shelf-life field: it
// follows the ingredient and the location on its own, but the moment a cook
// types a number it becomes theirs and stops moving.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AddItemModal from '../AddItemModal';
import { makeItem, makeLocation } from '../../../test-utils/factories';

const LOCATIONS = [
  makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' }),
  makeLocation({ id: 'loc-freezer', label: 'Freezer', type: 'freezer' }),
];

const renderModal = (props = {}) =>
  render(
    <AddItemModal
      show
      onHide={jest.fn()}
      onSave={jest.fn().mockResolvedValue({ success: true })}
      locations={LOCATIONS}
      {...props}
    />
  );

const shelfLifeField = () => screen.getByLabelText('Shelf Life (days)');
const nameField = () => screen.getByPlaceholderText(/Chicken Breast/);
const locationSelect = () => screen.getByLabelText(/Storage Location/);

describe('AddItemModal shelf life', () => {
  it('fills in the ingredient-and-location default once a location is picked', async () => {
    renderModal();

    await userEvent.type(nameField(), 'Chicken Breast');
    await userEvent.selectOptions(locationSelect(), 'loc-fridge');

    // Chicken keeps two days in the fridge, not the blanket seven.
    expect(shelfLifeField()).toHaveValue(2);
  });

  it('follows a rename to a different ingredient', async () => {
    renderModal();

    await userEvent.selectOptions(locationSelect(), 'loc-fridge');
    await userEvent.type(nameField(), 'Cheese');

    expect(shelfLifeField()).toHaveValue(21);
  });

  it('re-dates the item when the location changes', async () => {
    renderModal();

    await userEvent.type(nameField(), 'Milk');
    await userEvent.selectOptions(locationSelect(), 'loc-fridge');
    expect(shelfLifeField()).toHaveValue(7);

    await userEvent.selectOptions(locationSelect(), 'loc-freezer');
    expect(shelfLifeField()).toHaveValue(90);
  });

  it('stops moving the number once the cook has typed one', async () => {
    renderModal();

    await userEvent.type(nameField(), 'Milk');
    await userEvent.selectOptions(locationSelect(), 'loc-fridge');
    await userEvent.clear(shelfLifeField());
    await userEvent.type(shelfLifeField(), '3');

    await userEvent.selectOptions(locationSelect(), 'loc-freezer');

    expect(shelfLifeField()).toHaveValue(3);
  });

  it('shows the estimated expiry date it is working from', async () => {
    renderModal();

    await userEvent.type(nameField(), 'Milk');
    await userEvent.selectOptions(locationSelect(), 'loc-fridge');

    expect(screen.getByText(/Estimated expiry/)).toBeInTheDocument();
  });
});

describe('AddItemModal saving', () => {
  const fillValidItem = async (name = 'Milk') => {
    await userEvent.type(nameField(), name);
    await userEvent.type(screen.getByPlaceholderText('e.g. 2'), '2');
    await userEvent.selectOptions(locationSelect(), 'loc-fridge');
  };

  it('leaves the shelf life out of the payload when it was never chosen', async () => {
    // The hook then works it out — which is what lets a later move to the
    // freezer extend the expiry.
    const onSave = jest.fn().mockResolvedValue({ success: true });
    renderModal({ onSave });

    await fillValidItem();
    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].shelfLifeDays).toBeUndefined();
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'Milk',
      quantity: 2,
      locationId: 'loc-fridge',
      locationType: 'fridge',
    });
  });

  it('sends the shelf life the cook typed', async () => {
    const onSave = jest.fn().mockResolvedValue({ success: true });
    renderModal({ onSave });

    await fillValidItem();
    await userEvent.clear(shelfLifeField());
    await userEvent.type(shelfLifeField(), '21');
    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].shelfLifeDays).toBe(21);
  });

  it('refuses to save a nameless item', async () => {
    const onSave = jest.fn();
    renderModal({ onSave });

    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    expect(await screen.findByText(/Item name is required/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses to save without a quantity', async () => {
    const onSave = jest.fn();
    renderModal({ onSave });

    await userEvent.type(nameField(), 'Milk');
    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    expect(await screen.findByText(/Quantity must be a number/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses to save without somewhere to put it', async () => {
    const onSave = jest.fn();
    renderModal({ onSave });

    await userEvent.type(nameField(), 'Milk');
    await userEvent.type(screen.getByPlaceholderText('e.g. 2'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }));

    expect(await screen.findByText(/select a storage location/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('warns when there is nowhere to put anything', () => {
    renderModal({ locations: [] });

    expect(screen.getByText(/No storage locations found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeDisabled();
  });
});

describe('AddItemModal editing', () => {
  it('keeps a shelf life the cook chose earlier when the item is edited', async () => {
    const onSave = jest.fn().mockResolvedValue({ success: true });
    renderModal({
      editItem: makeItem({
        id: 'item-1',
        name: 'Milk',
        locationId: 'loc-fridge',
        locationType: 'fridge',
        shelfLifeDays: 3,
        shelfLifeSource: 'custom',
      }),
      onSave,
    });

    expect(shelfLifeField()).toHaveValue(3);

    await userEvent.selectOptions(locationSelect(), 'loc-freezer');
    expect(shelfLifeField()).toHaveValue(3);

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].shelfLifeDays).toBe(3);
  });

  it('re-dates a defaulted item when it is moved to the freezer', async () => {
    const onSave = jest.fn().mockResolvedValue({ success: true });
    renderModal({
      editItem: makeItem({
        id: 'item-1',
        name: 'Milk',
        locationId: 'loc-fridge',
        locationType: 'fridge',
        shelfLifeDays: 7,
        shelfLifeSource: 'default',
      }),
      onSave,
    });

    await userEvent.selectOptions(locationSelect(), 'loc-freezer');
    expect(shelfLifeField()).toHaveValue(90);

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Untouched, so the hook recalculates rather than being told.
    expect(onSave.mock.calls[0][0].shelfLifeDays).toBeUndefined();
    expect(onSave.mock.calls[0][0].locationType).toBe('freezer');
  });
});
