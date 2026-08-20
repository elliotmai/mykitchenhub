import React from 'react';

import { makeDelivery, renderWithProviders, screen } from '../../../test-utils';
import DeliveryHistory, { toDate } from '../DeliveryHistory';
import { Timestamp } from '../../../test-utils/mocks/firestore';

const setup = (props = {}) => {
  const onDelete = jest.fn();
  const utils = renderWithProviders(<DeliveryHistory onDelete={onDelete} {...props} />);
  return { ...utils, onDelete };
};

describe('toDate', () => {
  it('reads a Firestore Timestamp', () => {
    const now = new Date(2026, 7, 14);
    expect(toDate(Timestamp.fromDate(now)).getFullYear()).toBe(2026);
  });

  it('reads a plain Date from a just-made local write', () => {
    const now = new Date(2026, 7, 14);
    expect(toDate(now)).toEqual(now);
  });

  it('returns null for nothing usable', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate('not a date')).toBeNull();
  });
});

it('invites a first delivery when there is no history', () => {
  setup({ deliveries: [] });

  expect(screen.getByRole('heading', { name: /no deliveries yet/i })).toBeInTheDocument();
  expect(screen.getByText(/when your next box turns up/i)).toBeInTheDocument();
});

it('shows a loader rather than "no deliveries" while history is being fetched', () => {
  setup({ deliveries: [], loading: true });

  expect(screen.queryByRole('heading', { name: /no deliveries yet/i })).not.toBeInTheDocument();
  expect(screen.getByLabelText(/loading content/i)).toBeInTheDocument();
});

it('summarises each box: when, how many meals, how much went in', () => {
  setup({
    deliveries: [
      makeDelivery({
        id: 'd1',
        deliveredAt: Timestamp.fromDate(new Date(2026, 7, 14)),
        mealCount: 3,
        itemsAdded: 12,
      }),
    ],
  });

  expect(screen.getByText(/3 meals/i)).toBeInTheDocument();
  expect(screen.getByText(/12 ingredients added/i)).toBeInTheDocument();
  expect(screen.getByText(/Aug 14, 2026/)).toBeInTheDocument();
});

it('names the meals that came in the box', () => {
  setup({ deliveries: [makeDelivery({ recipeNames: ['Sweet Chili Chicken', 'Veggie Tacos'] })] });

  expect(screen.getByText('Sweet Chili Chicken')).toBeInTheDocument();
  expect(screen.getByText('Veggie Tacos')).toBeInTheDocument();
});

it('gets the singular right for a one-meal box', () => {
  setup({ deliveries: [makeDelivery({ mealCount: 1, itemsAdded: 1 })] });

  expect(screen.getByText(/1 meal$/i)).toBeInTheDocument();
  expect(screen.getByText(/1 ingredient added/i)).toBeInTheDocument();
});

it('shows the delivery status', () => {
  setup({ deliveries: [makeDelivery({ status: 'cooked' })] });

  expect(screen.getByText('cooked')).toBeInTheDocument();
});

it('shows any note left on the box', () => {
  setup({ deliveries: [makeDelivery({ notes: 'Box was missing the lime.' })] });

  expect(screen.getByText('Box was missing the lime.')).toBeInTheDocument();
});

it('lists newest first, in the order given', () => {
  setup({
    deliveries: [
      makeDelivery({ id: 'd2', recipeNames: ['Newest Box'] }),
      makeDelivery({ id: 'd1', recipeNames: ['Older Box'] }),
    ],
  });

  const names = screen.getAllByText(/Box$/).map((node) => node.textContent);
  expect(names).toEqual(['Newest Box', 'Older Box']);
});

it('hands the whole delivery back when one is removed', async () => {
  const delivery = makeDelivery({ id: 'd1' });
  const { onDelete, user } = setup({ deliveries: [delivery] });

  await user.click(screen.getByRole('button', { name: /remove delivery from/i }));

  expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
});

it('hides the remove button when there is nothing to handle it', () => {
  renderWithProviders(<DeliveryHistory deliveries={[makeDelivery()]} />);

  expect(screen.queryByRole('button', { name: /remove delivery/i })).not.toBeInTheDocument();
});

it('copes with a delivery missing its counts', () => {
  setup({ deliveries: [{ id: 'd1', deliveredAt: null }] });

  expect(screen.getByText(/date unknown/i)).toBeInTheDocument();
  expect(screen.getByText(/0 meals/i)).toBeInTheDocument();
});

it('hands the whole delivery back when one is edited', async () => {
  const delivery = makeDelivery({ id: 'd1' });
  const onEdit = jest.fn();
  const { user } = setup({ deliveries: [delivery], onEdit });

  await user.click(screen.getByRole('button', { name: /edit delivery from/i }));

  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
});

it('hides the edit button when there is nothing to handle it', () => {
  setup({ deliveries: [makeDelivery()] });

  expect(screen.queryByRole('button', { name: /edit delivery/i })).not.toBeInTheDocument();
});
