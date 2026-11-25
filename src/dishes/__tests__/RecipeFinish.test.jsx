// After saving a recipe: the dish it goes with, already picked, and a cover
// to choose when it has none.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as fs from '../../test-utils/mocks/firestore';
import { __callable } from '../../test-utils/mocks/functions';
import RecipeFinish from '../RecipeFinish';
import { adoptWebCover } from '../newRecipe';

const DISHES = [
  { id: 'meatball', name: 'Meatballs', recipes: [{ id: 'a', name: 'Meatballs' }] },
  {
    id: 'new-one',
    name: 'Easy Swedish Meatballs',
    recipes: [{ id: 'n1', name: 'Easy Swedish Meatballs' }],
  },
  { id: 'lasagna', name: 'Lasagna', recipes: [{ id: 'b', name: 'Lasagna' }] },
];
const IDEA = {
  url: 'https://img.test/1.jpg',
  thumbnail: 'https://img.test/1-t.jpg',
  title: 'Meatballs',
  creator: 'Jo',
  license: 'by',
  licenseVersion: '2.0',
  pageUrl: 'https://openverse.test/1',
};

const actions = () => ({
  moveRecipe: jest.fn(async () => ({ success: true })),
  moveToNewDish: jest.fn(async () => ({ success: true })),
  renameDish: jest.fn(async () => ({ success: true })),
});

beforeEach(() => {
  __callable('coverIdeas').mockResolvedValue({ data: { ideas: [IDEA] } });
  __callable('recipeCover').mockResolvedValue({
    data: { imageUrl: 'https://store.test/cover.jpg' },
  });
});

it('picks the dish it goes with, and one tap keeps it', async () => {
  const a = actions();
  const onDone = jest.fn();
  render(
    <RecipeFinish
      recipe={{ id: 'n1', name: 'Easy Swedish Meatballs', imageUrl: 'x.jpg' }}
      dishes={DISHES}
      actions={a}
      onDone={onDone}
    />
  );
  expect(screen.getByLabelText('Goes with Meatballs')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(a.moveRecipe).toHaveBeenCalledWith('n1', 'meatball');
  expect(__callable('coverIdeas')).not.toHaveBeenCalled();
});

it('makes a new dish when nothing matches, and can take a free photo as the cover', async () => {
  const a = actions();
  const onDone = jest.fn();
  render(
    <RecipeFinish
      recipe={{ id: 'z1', name: 'Banana Bread' }}
      dishes={[...DISHES, { id: 'banana-bread', name: 'Banana Bread', recipes: [{ id: 'z1' }] }]}
      actions={a}
      onDone={onDone}
    />
  );
  expect(screen.getByLabelText('Goes with a new dish, Banana Bread')).toBeInTheDocument();
  const photo = await screen.findByRole('button', { name: /Meatballs/ });
  expect(screen.getByText('Photo: Jo, CC BY 2.0')).toBeInTheDocument();
  await userEvent.click(photo);
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(a.moveToNewDish).not.toHaveBeenCalled();
  const [ref, data] = fs.updateDoc.mock.calls.at(-1);
  expect(fs.pathOf(ref)).toBe('recipes/z1');
  expect(data).toMatchObject({
    imageUrl: 'https://store.test/cover.jpg',
    coverSource: { kind: 'openverse', pageUrl: 'https://openverse.test/1', license: 'by' },
  });
});

it('can be moved to another dish or a new one before Done', async () => {
  const a = actions();
  render(
    <RecipeFinish
      recipe={{ id: 'n1', name: 'Easy Swedish Meatballs', imageUrl: 'x.jpg' }}
      dishes={DISHES}
      actions={a}
      onDone={jest.fn()}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'new dish' }));
  await userEvent.clear(screen.getByLabelText('New dish name'));
  await userEvent.type(screen.getByLabelText('New dish name'), 'Swedish Meatballs');
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(a.renameDish).toHaveBeenCalledWith('new-one', 'Swedish Meatballs'));
});

it('copies a web page’s photo into storage', async () => {
  const url = await adoptWebCover({
    id: 'w1',
    imageUrl: 'https://site.test/p.jpg',
    coverSource: { kind: 'web', pageUrl: 'https://site.test/p' },
  });
  expect(url).toBe('https://store.test/cover.jpg');
  expect(__callable('recipeCover')).toHaveBeenCalledWith(
    expect.objectContaining({ recipeId: 'w1', imageUrl: 'https://site.test/p.jpg' })
  );
  expect(await adoptWebCover({ id: 'w2', imageUrl: null })).toBeNull();
});
