// Events: plan a menu for a holiday, and shop for it by item.

import React from 'react';
import { renderWithProviders, screen, act, waitFor, within } from '../../test-utils';
import * as fs from '../../test-utils/mocks/firestore';
import { makeRecipe, asDocs } from '../../test-utils/factories';
import Events from '../Events';

const UID = 'test-uid';
const RECIPES = [
  makeRecipe({
    id: 'r1',
    name: 'Green Rice',
    ingredients: [{ name: 'Rice' }, { name: 'Cilantro' }],
  }),
  makeRecipe({ id: 'r2', name: 'Ribs', ingredients: [{ name: 'Pork ribs' }], timesCooked: 3 }),
  makeRecipe({
    id: 'r3',
    name: "Grandma's Ribs",
    ingredients: [{ name: 'Pork ribs' }, { name: 'Onion' }],
  }),
];
const THANKSGIVING = {
  id: 'e1',
  name: 'Thanksgiving',
  guests: 'The Smiths',
  notes: 'Bring chairs',
  days: [
    {
      id: 'd1',
      name: 'Thanksgiving',
      date: '2099-11-26',
      status: 'Not Started',
      menu: [{ dishId: 'rib', label: 'Ribs' }],
    },
  ],
};
const OLD = {
  id: 'e0',
  name: 'Fourth',
  days: [{ id: 'x', name: 'Fourth', date: '2020-07-04', status: 'Done', menu: [] }],
};

const renderEvents = async ({
  events = [THANKSGIVING, OLD],
  list = [],
  stores = [],
  memory = [],
} = {}) => {
  const view = renderWithProviders(<Events />, { route: '/events' });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit('events', asDocs(events));
    fs.__emit('recipes', asDocs(RECIPES));
    fs.__emit('dishes', []);
    fs.__emit(`users/${UID}/shoppingItems`, asDocs(list));
    fs.__emit('stores', asDocs(stores));
    fs.__emit('itemStores', asDocs(memory));
  });
  return view;
};

it('lists upcoming events with their guests, notes and menu, and hides past ones', async () => {
  const { user } = await renderEvents();
  const card = screen.getByRole('heading', { name: 'Thanksgiving' }).closest('.card');
  expect(within(card).getByText('The Smiths')).toBeInTheDocument();
  expect(within(card).getByText('Bring chairs')).toBeInTheDocument();
  expect(within(card).getByText('Ribs', { selector: 'span' })).toBeInTheDocument();
  expect(within(card).getByText(/any of 2/)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Fourth' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Show past events \(1\)/ }));
  expect(screen.getByRole('heading', { name: 'Fourth' })).toBeInTheDocument();
});

it('adds an event, with a date or without', async () => {
  const { user } = await renderEvents({ events: [] });
  expect(screen.getByText(/No events yet/)).toBeInTheDocument();
  await user.type(screen.getByLabelText('Event'), 'Game night');
  await user.click(screen.getByRole('button', { name: /Add event/ }));
  await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
  const [ref, data] = fs.addDoc.mock.calls.at(-1);
  expect(fs.pathOf(ref)).toBe('events');
  expect(data).toMatchObject({
    name: 'Game night',
    days: [expect.objectContaining({ date: null, menu: [] })],
  });
});

it('changes a day and its menu, saving the whole event', async () => {
  const { user } = await renderEvents();
  await user.selectOptions(screen.getByLabelText('Status of Thanksgiving'), 'Shopping');
  let [ref, data] = fs.setDoc.mock.calls.at(-1);
  expect(fs.pathOf(ref)).toBe('events/e1');
  expect(data.days[0].status).toBe('Shopping');

  await user.selectOptions(screen.getByLabelText('Add to the Thanksgiving menu'), 'recipe:r1');
  await user.click(
    within(screen.getByLabelText('Add to the Thanksgiving menu').closest('form')).getByRole(
      'button',
      { name: /Add/ }
    )
  );
  [ref, data] = fs.setDoc.mock.calls.at(-1);
  expect(data.days[0].menu).toEqual([
    { dishId: 'rib', label: 'Ribs' },
    { recipeId: 'r1', label: 'Green Rice' },
  ]);

  await user.click(screen.getByRole('button', { name: 'Take Ribs off the menu' }));
  [ref, data] = fs.setDoc.mock.calls.at(-1);
  expect(data.days[0].menu).toEqual([]);

  await user.click(screen.getByRole('button', { name: /Add a day/ }));
  [ref, data] = fs.setDoc.mock.calls.at(-1);
  expect(data.days).toHaveLength(2);
});

it('edits the details and deletes after asking', async () => {
  const { user } = await renderEvents();
  await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  await user.clear(screen.getByLabelText('Guests'));
  await user.type(screen.getByLabelText('Guests'), 'Everyone');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(fs.setDoc.mock.calls.at(-1)[1]).toMatchObject({ guests: 'Everyone' });

  await user.click(screen.getByRole('button', { name: 'Delete Thanksgiving' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(fs.deleteDoc).toHaveBeenCalled());
  expect(fs.pathOf(fs.deleteDoc.mock.calls.at(-1)[0])).toBe('events/e1');
});

it('shops for the menu by item, no amounts, in each item’s usual store, skipping what is listed', async () => {
  const { user } = await renderEvents({
    list: [{ id: 's1', name: 'Onion', normalized: 'onion', status: 'pending' }],
    stores: [{ id: 'costco', name: 'Costco' }],
    memory: [{ id: 'pork-rib', store: 'costco' }],
  });
  await user.click(screen.getByRole('button', { name: /Add Thanksgiving to the shopping list/ }));
  await waitFor(() => expect(fs.addDoc).toHaveBeenCalled());
  const added = fs.addDoc.mock.calls.map(([, data]) => data);
  expect(added).toEqual([
    expect.objectContaining({
      name: 'Pork ribs',
      quantity: null,
      store: 'costco',
      recipeName: 'Ribs',
      eventId: 'e1',
    }),
  ]);
});

it('says so when the menu is already on the list', async () => {
  const { user } = await renderEvents({
    list: [{ id: 's1', name: 'Pork ribs', normalized: 'pork ribs', status: 'pending' }],
  });
  await user.click(screen.getByRole('button', { name: /Add Thanksgiving to the shopping list/ }));
  expect(await screen.findByText(/already on the shopping list/)).toBeInTheDocument();
  expect(fs.addDoc).not.toHaveBeenCalled();
});
