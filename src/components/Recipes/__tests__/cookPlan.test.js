// How cook mode splits a recipe: ingredients per step, and steps done together.

import {
  canOverlap,
  formatQuantity,
  ingredientParts,
  isHandsOff,
  planCards,
  stepIngredientIndexes,
} from '../cookPlan';

describe('steps that can run together', () => {
  it('reads a wait from the step', () => {
    expect(isHandsOff('Preheat the oven to 425°F.')).toBe(true);
    expect(isHandsOff('Bring a large pot of salted water to a boil.')).toBe(true);
    expect(isHandsOff('Roast for 25 minutes, until golden.')).toBe(true);
    expect(isHandsOff('Simmer 2 min.')).toBe(false); // too short to start anything
    expect(isHandsOff('Brown the beef for 8 minutes, stirring.')).toBe(false); // hands on
    expect(isHandsOff('Chop the onion.')).toBe(false);
  });

  it('pulls forward prep, and anything that says meanwhile, but nothing that needs the pot', () => {
    expect(canOverlap('Chop the parsley.')).toBe(true);
    expect(canOverlap('Meanwhile, heat the oil in a skillet.')).toBe(true);
    expect(canOverlap('Drain the pasta and toss with the sauce.')).toBe(false);
    expect(canOverlap('Slice the chicken once it has rested.')).toBe(false);
    expect(canOverlap('Heat the oil in a skillet.')).toBe(false);
  });

  it('puts a wait and its prep on one card, and the rest on their own', () => {
    const steps = [
      'Preheat the oven to 400°F.',
      'Dice the potatoes.',
      'Mince the garlic.',
      'Toss the potatoes with oil and roast for 25 minutes.',
      'Meanwhile, whisk the dressing.',
      'Remove from the oven and serve.',
    ];
    expect(planCards(steps)).toEqual([
      { steps: [0, 1, 2], parallel: true },
      { steps: [3, 4], parallel: true },
      { steps: [5], parallel: false },
    ]);
  });

  it('stops at three steps beside one wait', () => {
    const steps = ['Bake for 40 minutes.', 'Chop a.', 'Chop b.', 'Chop c.', 'Chop d.'];
    expect(planCards(steps)[0].steps).toEqual([0, 1, 2, 3]);
    expect(planCards(steps)[1].steps).toEqual([4]);
  });
});

describe('ingredients per step', () => {
  const ingredients = [
    { name: 'ground beef', quantity: 10, unit: 'oz' },
    { name: 'yellow onion', quantity: 1, unit: '' },
    { name: 'olive oil', quantity: 2, unit: 'tbsp' },
    { name: 'sesame oil', quantity: 1, unit: 'tsp' },
    { name: 'tomatoes', quantity: 1.5, unit: 'cups' },
    '2 cloves garlic, minced',
  ];

  it('finds what a step names, by its noun or its full name', () => {
    expect(stepIngredientIndexes('Brown the beef with the onion.', ingredients)).toEqual([0, 1]);
    expect(stepIngredientIndexes('Add the tomato and garlic.', ingredients)).toEqual([4, 5]);
  });

  it('needs the full name when two ingredients share a noun', () => {
    expect(stepIngredientIndexes('Heat the oil.', ingredients)).toEqual([]);
    expect(stepIngredientIndexes('Heat the olive oil.', ingredients)).toEqual([2]);
  });

  it('shows the amount apart from the name', () => {
    expect(ingredientParts(ingredients[4])).toEqual({ amount: '1½ cups', name: 'tomatoes' });
    expect(ingredientParts('2 cloves garlic, minced')).toEqual({
      amount: '2 cloves',
      name: 'garlic, minced',
    });
    expect(ingredientParts('salt to taste')).toEqual({ amount: '', name: 'salt to taste' });
    expect(formatQuantity(0.25)).toBe('¼');
    expect(formatQuantity(2)).toBe('2');
  });
});
