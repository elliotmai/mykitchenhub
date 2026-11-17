/**
 * A stored recipe as Fridge Board's step cards.
 *
 * The inputs are the shapes KitchenHub's writers actually produce: string
 * arrays from the HelloFresh normaliser and the Markdown importer (with its
 * "Group: step" headings), and the one-blob strings old legacy imports hold.
 */

const {
  MISSING_STEPS_PLACEHOLDER,
  calories,
  formatMinutes,
  formatQuantity,
  ingredientLine,
  recipeSteps,
  splitBlob,
  timerMinutes,
  toRecipeCard,
} = require('../recipeCards');

describe('timerMinutes', () => {
  it.each([
    ['Roast for 15 minutes.', 15],
    ['Simmer 10–12 min, stirring.', 10],
    ['Simmer 10-12 minutes', 10],
    ['Bake 20 to 25 mins', 20],
    ['Rest for 1 hour', 60],
    ['Braise 1.5 hrs', 90],
    ['Stir for 30 seconds.', null],
    ['Heat the oven to 220C.', null],
    ['Season to taste.', null],
  ])('%s → %s', (text, expected) => {
    expect(timerMinutes(text)).toBe(expected);
  });
});

describe('recipeSteps', () => {
  it('maps a list of steps to numbered cards, one paragraph per line', () => {
    expect(
      recipeSteps(['Preheat the oven.', 'Roast the carrots for 25 minutes.\nToss halfway.'])
    ).toEqual([
      { title: 'Step 1', text: ['Preheat the oven.'], uses: [] },
      {
        title: 'Step 2',
        text: ['Roast the carrots for 25 minutes.', 'Toss halfway.'],
        uses: [],
        timer: 25,
      },
    ]);
  });

  it('takes a title from the importer\'s "Heading: step" form', () => {
    expect(recipeSteps(['For the sauce: Whisk the soy and honey.'])).toEqual([
      { title: 'For the sauce', text: ['Whisk the soy and honey.'], uses: [] },
    ]);
  });

  it('does not mistake a sentence with a colon for a heading', () => {
    const [card] = recipeSteps(['Heat oven to 220C: the tray goes in hot.']);
    expect(card.title).toBe('Step 1');
    expect(card.text).toEqual(['Heat oven to 220C: the tray goes in hot.']);
  });

  it('drops numbering the source already wrote, without eating a decimal', () => {
    expect(
      recipeSteps(['Step 1: Chop the onion.', '2) Fry it.', '1.5 cups of stock go in.']).map(
        (c) => c.text[0]
      )
    ).toEqual(['Chop the onion.', 'Fry it.', '1.5 cups of stock go in.']);
  });

  it('skips blanks and the importer placeholder, and numbers what is left', () => {
    expect(recipeSteps(['', '  ', MISSING_STEPS_PLACEHOLDER])).toEqual([]);
    expect(recipeSteps(['', 'Only step.']).map((c) => c.title)).toEqual(['Step 1']);
  });

  it('reads a structured step if a writer ever stores one', () => {
    expect(
      recipeSteps([
        {
          title: 'Sear',
          text: 'Sear the steak.',
          uses: [{ name: 'steak', quantity: 2, unit: '' }, '1 tbsp oil'],
          timer: 4,
        },
      ])
    ).toEqual([
      { title: 'Sear', text: ['Sear the steak.'], uses: ['2 steak', '1 tbsp oil'], timer: 4 },
    ]);
  });

  it('returns no cards for missing instructions', () => {
    expect(recipeSteps(undefined)).toEqual([]);
    expect(recipeSteps(null)).toEqual([]);
  });
});

describe('splitBlob — one string of instructions', () => {
  it('splits on its own numbering', () => {
    expect(splitBlob('1. Boil water. 2. Add pasta and cook 9 minutes. 3. Drain.')).toEqual([
      'Boil water.',
      'Add pasta and cook 9 minutes.',
      'Drain.',
    ]);
  });

  it('splits on line breaks', () => {
    expect(splitBlob('Boil water.\n\nAdd pasta.\nDrain.')).toEqual([
      'Boil water.',
      'Add pasta.',
      'Drain.',
    ]);
  });

  it('keeps a short paragraph as one step', () => {
    expect(splitBlob('Mix everything and serve.')).toEqual(['Mix everything and serve.']);
  });

  it('splits one long paragraph into pairs of sentences', () => {
    const sentence = (n) =>
      `Sentence number ${n} is here to make this paragraph long enough to split up properly.`;
    const blob = [1, 2, 3, 4, 5].map(sentence).join(' ');
    expect(splitBlob(blob)).toEqual([
      `${sentence(1)} ${sentence(2)}`,
      `${sentence(3)} ${sentence(4)}`,
      sentence(5),
    ]);
  });
});

describe('ingredientLine', () => {
  it.each([
    [{ name: 'ground beef', quantity: 10, unit: 'oz' }, '10 oz ground beef'],
    [{ name: 'garlic', quantity: 2, unit: 'clove' }, '2 clove garlic'],
    [{ name: 'lime', quantity: 0.5, unit: '' }, '1/2 lime'],
    [{ name: 'flour', quantity: 1.5, unit: 'cup' }, '1 1/2 cup flour'],
    [{ name: 'salt', quantity: 0, unit: '' }, 'salt'],
    [{ name: 'oil', quantity: 0.3, unit: 'cup' }, '0.3 cup oil'],
    [{ name: 'eggs', quantity: 2, unit: '', text: '2 large eggs, beaten' }, '2 large eggs, beaten'],
    ['3 carrots', '3 carrots'],
    [{ quantity: 2 }, ''],
  ])('%j → %j', (ingredient, expected) => {
    expect(ingredientLine(ingredient)).toBe(expected);
  });

  it('formats awkward quantities', () => {
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(0.25)).toBe('1/4');
    expect(formatQuantity(2 / 3)).toBe('2/3');
    expect(formatQuantity('x')).toBe('');
  });
});

describe('card header fields', () => {
  it.each([
    [null, null],
    [35, '35 min'],
    [60, '1 hr'],
    [70, '1 hr 10 min'],
  ])('formatMinutes(%s) → %s', (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });

  it.each([
    [{ nutrition: { calories: '780 kcal' } }, 780],
    [{ nutrition: { Calories: '1,050' } }, 1050],
    [{ nutrition: { energy: '450' } }, 450],
    [{ nutrition: { protein: '30 g' } }, null],
    [{ calories: 512.4 }, 512],
    [{}, null],
  ])('calories(%j) → %s', (recipe, expected) => {
    expect(calories(recipe)).toBe(expected);
  });

  it('maps a whole HelloFresh-shaped recipe', () => {
    expect(
      toRecipeCard({
        name: 'Sweet Chili Chicken',
        description: 'Sticky, spicy, done in half an hour.\n\nMore notes.',
        prepTime: 10,
        cookTime: 20,
        servings: 2,
        ingredients: [
          { name: 'chicken breast', quantity: 10, unit: 'oz', normalized: 'chicken breast' },
        ],
        instructions: ['Cook the rice for 15–18 minutes.', 'Glaze: Toss the chicken in the sauce.'],
      })
    ).toEqual({
      name: 'Sweet Chili Chicken',
      sub: 'Sticky, spicy, done in half an hour.',
      time: '30 min',
      serves: 2,
      cal: null,
      ingredients: ['10 oz chicken breast'],
      steps: [
        { title: 'Step 1', text: ['Cook the rice for 15–18 minutes.'], uses: [], timer: 15 },
        { title: 'Glaze', text: ['Toss the chicken in the sauce.'], uses: [] },
      ],
    });
  });

  it('fills what it cannot read with null, and borrows the meal name if the recipe has none', () => {
    expect(toRecipeCard({}, 'Leftovers')).toEqual({
      name: 'Leftovers',
      sub: null,
      time: null,
      serves: null,
      cal: null,
      ingredients: [],
      steps: [],
    });
  });
});
