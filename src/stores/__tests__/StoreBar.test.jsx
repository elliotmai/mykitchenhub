// Shopping by store on the shopping list.

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ShoppingList from '../../components/MealPlan/ShoppingList';
import { NO_STORE, storeFor } from '../storeLogic';

const STORES = [
  { id: 'costco', name: 'Costco', order: 0 },
  { id: 'tj', name: "Trader Joe's", order: 1 },
];
const manual = [
  { id: 'm1', name: 'Vodka', status: 'pending', store: 'costco' },
  { id: 'm2', name: 'Celery', status: 'pending' },
];
const derived = [{ key: 'k1', name: 'crackers', normalized: 'crackers', quantity: 1, unit: '' }];

const renderList = (props = {}) => {
  const handlers = {
    onAddItem: jest.fn(async () => ({ success: true })),
    onToggleBought: jest.fn(),
    onRemoveItem: jest.fn(),
    onClearBought: jest.fn(),
    onSetStore: jest.fn(async () => ({ success: true })),
    onAddStore: jest.fn(async () => ({ success: true })),
    onRemoveStore: jest.fn(),
  };
  const memory = { cracker: { store: 'tj' } };
  render(
    <ShoppingList
      items={derived}
      manualItems={manual}
      stores={STORES}
      storeOf={(row) => storeFor(row, memory, STORES)}
      usualStore={(name) => (name.toLowerCase() === 'milk' ? 'tj' : null)}
      {...handlers}
      {...props}
    />
  );
  return { user: userEvent.setup(), ...handlers };
};

it('reads the list store by store, with No store yet last', async () => {
  const { user } = renderList();
  await user.click(screen.getByRole('button', { name: 'By store' }));
  const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
  expect(headings).toEqual(['Costco', "Trader Joe's", 'No store yet']);
  const costco = screen.getByRole('heading', { name: 'Costco' }).closest('section');
  expect(within(costco).getByText('Vodka')).toBeInTheDocument();
  const tj = screen.getByRole('heading', { name: "Trader Joe's" }).closest('section');
  expect(within(tj).getByText('crackers')).toBeInTheDocument();
});

it('shows one store’s part of the list', async () => {
  const { user } = renderList();
  await user.selectOptions(screen.getByLabelText('Show one store'), NO_STORE);
  expect(screen.getByText('Celery')).toBeInTheDocument();
  expect(screen.queryByText('Vodka')).not.toBeInTheDocument();
});

it('sends a line to a store, typed or from the week', async () => {
  const { user, onSetStore } = renderList();
  await user.selectOptions(screen.getByLabelText('Store for Celery'), 'tj');
  expect(onSetStore).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }), 'tj');
  await user.selectOptions(screen.getByLabelText('Store for crackers'), 'costco');
  expect(onSetStore).toHaveBeenCalledWith(expect.objectContaining({ key: 'k1' }), 'costco');
});

it('adds an item without an amount, to its usual store unless one is picked', async () => {
  const { user, onAddItem } = renderList();
  await user.type(screen.getByLabelText('Add something to the shopping list'), 'Milk');
  await user.click(screen.getByRole('button', { name: /^Add$/ }));
  expect(onAddItem).toHaveBeenCalledWith({ name: 'Milk', quantity: '', unit: '', store: 'tj' });

  await user.type(screen.getByLabelText('Add something to the shopping list'), 'Eggs');
  await user.selectOptions(screen.getByLabelText('Store for the new item'), 'costco');
  await user.click(screen.getByRole('button', { name: /^Add$/ }));
  expect(onAddItem).toHaveBeenLastCalledWith({
    name: 'Eggs',
    quantity: '',
    unit: '',
    store: 'costco',
  });
});

it('keeps the list of stores', async () => {
  const { user, onAddStore, onRemoveStore } = renderList();
  await user.click(screen.getByRole('button', { name: /Stores/ }));
  await user.type(screen.getByLabelText('New store'), 'Winco');
  await user.click(screen.getByRole('button', { name: 'Add store' }));
  expect(onAddStore).toHaveBeenCalledWith('Winco');
  await user.click(screen.getByRole('button', { name: 'Remove Costco' }));
  expect(onRemoveStore).toHaveBeenCalledWith('costco');
});

it('says why a store could not be added', async () => {
  const { user } = renderList({
    onAddStore: jest.fn(async () => ({ success: false, error: 'Costco is already on the list.' })),
  });
  await user.click(screen.getByRole('button', { name: /Stores/ }));
  await user.type(screen.getByLabelText('New store'), 'Costco');
  await user.click(screen.getByRole('button', { name: 'Add store' }));
  expect(await screen.findByText('Costco is already on the list.')).toBeInTheDocument();
});

it('shows where a line from an event came from', () => {
  renderList({
    manualItems: [{ id: 'm3', name: 'Rice', status: 'pending', recipeName: 'Green Rice' }],
  });
  expect(screen.getByText('for Green Rice')).toBeInTheDocument();
});

it('is the plain list when the page has no stores', () => {
  renderList({ stores: null });
  expect(screen.queryByRole('button', { name: 'By store' })).not.toBeInTheDocument();
});
