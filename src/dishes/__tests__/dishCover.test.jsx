// A dish's cover: its chosen photo, else a collage of its recipes' photos;
// and the dish a new recipe goes with.

import React from 'react';
import { render, screen } from '@testing-library/react';

import { dishCover, groupDishes, nameMatch, suggestDish } from '../dishLogic';
import DishCollage from '../DishCollage';

const r = (id, extra = {}) => ({
  id,
  name: 'Lasagna',
  createdAt: { $ts: Number(id.slice(1)) },
  ...extra,
});
const dish = (recipes, extra = {}) => ({
  id: 'lasagna',
  name: 'Lasagna',
  recipes,
  favoriteId: null,
  ...extra,
});

describe('dishCover', () => {
  it('uses the chosen cover over the recipes', () => {
    const d = dish([r('r1', { imageUrl: 'a.jpg' })], { coverUrl: 'chosen.jpg' });
    expect(dishCover(d)).toEqual({ images: [{ url: 'chosen.jpg', alt: 'Lasagna' }], more: 0 });
  });

  it('skips recipes without a photo; favourite first, then the newest; +N for the rest', () => {
    const d = dish(
      [
        r('r1', { imageUrl: '1.jpg' }),
        r('r2'),
        r('r3', { imageUrl: '3.jpg' }),
        r('r4', { imageUrl: '4.jpg' }),
        r('r5', { imageUrl: '5.jpg' }),
        r('r6', { imageUrl: '6.jpg' }),
        r('r7', { imageUrl: '  ' }),
      ],
      { favoriteId: 'r1' }
    );
    const { images, more } = dishCover(d);
    expect(images.map((i) => i.url)).toEqual(['1.jpg', '6.jpg', '5.jpg', '4.jpg']);
    expect(more).toBe(1);
  });

  it('is empty with no photos, and for no dish', () => {
    expect(dishCover(dish([r('r1')])).images).toEqual([]);
    expect(dishCover(null)).toEqual({ images: [], more: 0 });
  });

  it('carries the cover through groupDishes', () => {
    const [d] = groupDishes([r('r1')], { lasagna: { coverUrl: 'c.jpg', coverRecipeId: 'r1' } });
    expect(d.coverUrl).toBe('c.jpg');
    expect(d.coverRecipeId).toBe('r1');
  });
});

describe('DishCollage', () => {
  const photos = (n) =>
    Array.from({ length: n }, (_, i) =>
      r(`r${i + 1}`, { imageUrl: `${i + 1}.jpg`, name: `L${i + 1}` })
    );

  it.each([1, 2, 3, 4])('lays out %i photo(s)', (n) => {
    const { container } = render(<DishCollage dish={dish(photos(n))} />);
    expect(container.querySelector('.dish-collage')).toHaveAttribute('data-count', String(n));
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(n);
    imgs.forEach((img) => expect(img).toHaveAttribute('loading', 'lazy'));
  });

  it('shows +N past four', () => {
    render(<DishCollage dish={dish(photos(6))} />);
    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('has a placeholder with no photos', () => {
    const { container } = render(<DishCollage dish={dish([r('r1')])} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('.dish-collage')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('suggestDish', () => {
  const dishes = [
    { id: 'meatball', name: 'Meatballs', recipes: [{ id: 'a', name: 'Meatballs' }] },
    {
      id: 'lasagna',
      name: 'Lasagna',
      recipes: [
        { id: 'b', name: 'Lasagna' },
        { id: 'c', name: 'Veggie Lasagna' },
      ],
    },
    { id: 'potato-soup', name: 'Loaded Potato Soup', recipes: [{ id: 'd', name: 'Go Big Spud' }] },
  ];

  it('ignores words like easy, best and homemade', () => {
    expect(suggestDish('The Best Easy Homemade Meatballs Recipe', dishes).dish.id).toBe('meatball');
  });

  it('matches near spellings and kinds of a dish', () => {
    expect(suggestDish('Classic Lasagne', dishes).dish.id).toBe('lasagna');
    expect(suggestDish('Swedish Meatballs', dishes).dish.id).toBe('meatball');
    expect(suggestDish('Cheesy loaded potato soup', dishes).dish.id).toBe('potato-soup');
  });

  it('suggests nothing when nothing is close', () => {
    expect(suggestDish('Banana Bread', dishes)).toBeNull();
    expect(nameMatch('', 'Meatballs')).toBe(0);
  });
});
