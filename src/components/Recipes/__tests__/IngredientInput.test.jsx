// Ingredient rows, with autocomplete drawn from what is actually in the
// kitchen. Getting cooks to reuse their inventory's wording is what makes
// "recipes I can make tonight" work later, so the suggestions matter.

import React from 'react';
import { renderWithProviders, screen } from '../../../test-utils';
import IngredientInput, { emptyIngredient, COMMON_INGREDIENTS } from '../IngredientInput';

describe('IngredientInput', () => {
  it('starts with one blank row rather than nothing to type into', () => {
    renderWithProviders(<IngredientInput ingredients={[]} onChange={jest.fn()} />);

    expect(screen.getByLabelText('Ingredient 1 name')).toHaveValue('');
  });

  it('renders the rows it was given', () => {
    renderWithProviders(
      <IngredientInput
        ingredients={[
          { name: 'salmon', quantity: 2, unit: 'piece' },
          { name: 'spinach', quantity: 1, unit: '' },
        ]}
        onChange={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Ingredient 1 name')).toHaveValue('salmon');
    expect(screen.getByLabelText('Ingredient 2 name')).toHaveValue('spinach');
  });

  it('reports a typed name back to the form', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <IngredientInput ingredients={[emptyIngredient()]} onChange={onChange} />
    );

    await user.type(screen.getByLabelText('Ingredient 1 name'), 'r');

    expect(onChange).toHaveBeenCalledWith([{ name: 'r', quantity: '', unit: '' }]);
  });

  it('reports a quantity and a unit', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <IngredientInput
        ingredients={[{ name: 'rice', quantity: '', unit: '' }]}
        onChange={onChange}
      />
    );

    await user.type(screen.getByLabelText('Ingredient 1 quantity'), '2');
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'rice', quantity: '2', unit: '' }]);

    await user.selectOptions(screen.getByLabelText('Ingredient 1 unit'), 'cup');
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'rice', quantity: '', unit: 'cup' }]);
  });

  it('adds a row', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <IngredientInput ingredients={[{ name: 'rice' }]} onChange={onChange} />
    );

    await user.click(screen.getByRole('button', { name: /add ingredient/i }));

    expect(onChange).toHaveBeenCalledWith([{ name: 'rice' }, emptyIngredient()]);
  });

  it('removes a row', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <IngredientInput ingredients={[{ name: 'rice' }, { name: 'beans' }]} onChange={onChange} />
    );

    await user.click(screen.getByRole('button', { name: 'Remove ingredient 1' }));

    expect(onChange).toHaveBeenCalledWith([{ name: 'beans' }]);
  });

  it('keeps one empty row when the last one is removed', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <IngredientInput ingredients={[{ name: 'rice' }]} onChange={onChange} />
    );

    await user.click(screen.getByRole('button', { name: 'Remove ingredient 1' }));

    expect(onChange).toHaveBeenCalledWith([emptyIngredient()]);
  });

  describe('autocomplete', () => {
    const optionValues = () =>
      Array.from(document.querySelectorAll('datalist option')).map((o) => o.value);

    it("offers what is in the cook's kitchen", () => {
      renderWithProviders(
        <IngredientInput ingredients={[]} suggestions={['Leftover Turkey']} onChange={jest.fn()} />
      );

      expect(optionValues()).toContain('Leftover Turkey');
    });

    it('offers staples so an empty kitchen still autocompletes', () => {
      renderWithProviders(<IngredientInput ingredients={[]} onChange={jest.fn()} />);

      expect(optionValues()).toEqual(expect.arrayContaining(COMMON_INGREDIENTS.slice(0, 3)));
    });

    it("prefers the kitchen's own spelling over the staple list", () => {
      renderWithProviders(
        <IngredientInput ingredients={[]} suggestions={['Butter']} onChange={jest.fn()} />
      );

      const values = optionValues();
      expect(values).toContain('Butter');
      expect(values).not.toContain('butter');
    });

    it('wires the name field to the suggestion list', () => {
      renderWithProviders(<IngredientInput ingredients={[]} onChange={jest.fn()} />);

      const list = screen.getByLabelText('Ingredient 1 name').getAttribute('list');
      expect(document.getElementById(list).tagName).toBe('DATALIST');
    });
  });
});
