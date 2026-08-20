// Correcting a delivery already in the history. The date handling is the part
// worth pinning: a `yyyy-mm-dd` field parsed as UTC lands on the previous day
// anywhere west of Greenwich, and the whole point of the edit is the date.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EditDeliveryModal from '../EditDeliveryModal';
import { DELIVERY_STATUSES } from '../../../hooks/useDeliveries';

const delivery = {
  id: 'del-1',
  status: 'received',
  deliveredAt: new Date('2026-08-18T12:00:00'),
  weekOf: '2026-08-17',
  notes: '',
  mealCount: 3,
  itemsAdded: 12,
  source: 'hellofresh',
};

const setup = (props = {}) => {
  const onSave = jest.fn(async () => ({ success: true }));
  const onHide = jest.fn();
  const utils = render(
    <EditDeliveryModal show onHide={onHide} onSave={onSave} delivery={delivery} {...props} />
  );
  return { ...utils, onSave, onHide };
};

it('renders nothing when no delivery is open', () => {
  const { container } = render(
    <EditDeliveryModal show onHide={jest.fn()} onSave={jest.fn()} delivery={null} />
  );

  expect(container).toBeEmptyDOMElement();
});

it('opens seeded with the delivery as it currently stands', () => {
  setup();

  expect(screen.getByLabelText(/status/i)).toHaveValue('received');
  expect(screen.getByLabelText(/arrived/i)).toHaveValue('2026-08-18');
  expect(screen.getByLabelText(/week of/i)).toHaveValue('2026-08-17');
});

it('offers exactly the statuses the rules accept', () => {
  setup();

  const options = screen.getAllByRole('option');
  expect(options.map((option) => option.value)).toEqual([...DELIVERY_STATUSES]);
});

it('reads a Firestore Timestamp as readily as a Date', () => {
  render(
    <EditDeliveryModal
      show
      onHide={jest.fn()}
      onSave={jest.fn()}
      delivery={{ ...delivery, deliveredAt: { toDate: () => new Date('2026-08-18T12:00:00') } }}
    />
  );

  expect(screen.getByLabelText(/arrived/i)).toHaveValue('2026-08-18');
});

it('leaves the date field blank rather than showing "NaN" for an unparseable value', () => {
  render(
    <EditDeliveryModal
      show
      onHide={jest.fn()}
      onSave={jest.fn()}
      delivery={{ ...delivery, deliveredAt: 'not a date' }}
    />
  );

  expect(screen.getByLabelText(/arrived/i)).toHaveValue('');
});

it('re-seeds when a different delivery is opened', () => {
  const { rerender } = setup();

  rerender(
    <EditDeliveryModal
      show
      onHide={jest.fn()}
      onSave={jest.fn()}
      delivery={{ ...delivery, id: 'del-2', status: 'cooked', weekOf: '2026-08-10' }}
    />
  );

  expect(screen.getByLabelText(/status/i)).toHaveValue('cooked');
  expect(screen.getByLabelText(/week of/i)).toHaveValue('2026-08-10');
});

it('hands the changed fields to the caller with the delivery they belong to', async () => {
  const user = userEvent.setup();
  const { onSave } = setup();

  await user.selectOptions(screen.getByLabelText(/status/i), 'cooked');
  await user.type(screen.getByLabelText(/notes/i), 'Salmon was short a fillet');
  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith(
    delivery,
    expect.objectContaining({
      status: 'cooked',
      weekOf: '2026-08-17',
      notes: 'Salmon was short a fillet',
    })
  );
});

it('keeps the day the user picked, not the one UTC would roll it back to', async () => {
  const user = userEvent.setup();
  const { onSave } = setup();

  await user.clear(screen.getByLabelText(/arrived/i));
  await user.type(screen.getByLabelText(/arrived/i), '2026-08-19');
  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const { deliveredAt } = onSave.mock.calls[0][1];
  expect(deliveredAt.getFullYear()).toBe(2026);
  expect(deliveredAt.getMonth()).toBe(7); // August
  expect(deliveredAt.getDate()).toBe(19);
});

it('never offers the counts the import produced', () => {
  setup();

  expect(screen.queryByLabelText(/meals/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/items/i)).not.toBeInTheDocument();
  expect(screen.getByText(/not editable/i)).toBeInTheDocument();
});

it('closes once the save lands', async () => {
  const user = userEvent.setup();
  const { onHide } = setup();

  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onHide).toHaveBeenCalled());
});

it('stays open when the save is refused', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn(async () => ({ success: false, error: 'Nope.' }));
  const { onHide } = setup({ onSave });

  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onHide).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
});

it('cancels without writing anything', async () => {
  const user = userEvent.setup();
  const { onHide, onSave } = setup();

  await user.click(screen.getByRole('button', { name: /cancel/i }));

  expect(onHide).toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});
