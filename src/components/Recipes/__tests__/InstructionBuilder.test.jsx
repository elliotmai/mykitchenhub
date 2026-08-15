// Numbered instruction steps. Steps are an array rather than one text blob so
// the detail view can number them and a cook can reorder one without retyping.

import React from 'react';
import { renderWithProviders, screen } from '../../../test-utils';
import InstructionBuilder from '../InstructionBuilder';

describe('InstructionBuilder', () => {
  it('starts with one empty step', () => {
    renderWithProviders(<InstructionBuilder steps={[]} onChange={jest.fn()} />);

    expect(screen.getByLabelText('Step 1')).toHaveValue('');
  });

  it('numbers the steps it was given', () => {
    renderWithProviders(
      <InstructionBuilder steps={['Heat the oven.', 'Roast.']} onChange={jest.fn()} />
    );

    expect(screen.getByLabelText('Step 1')).toHaveValue('Heat the oven.');
    expect(screen.getByLabelText('Step 2')).toHaveValue('Roast.');
  });

  it('reports an edited step', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(<InstructionBuilder steps={['']} onChange={onChange} />);

    await user.type(screen.getByLabelText('Step 1'), 'H');

    expect(onChange).toHaveBeenCalledWith(['H']);
  });

  it('adds a step', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <InstructionBuilder steps={['Heat the oven.']} onChange={onChange} />
    );

    await user.click(screen.getByRole('button', { name: /add step/i }));

    expect(onChange).toHaveBeenCalledWith(['Heat the oven.', '']);
  });

  it('removes a step', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <InstructionBuilder steps={['One.', 'Two.']} onChange={onChange} />
    );

    await user.click(screen.getByRole('button', { name: 'Remove step 1' }));

    expect(onChange).toHaveBeenCalledWith(['Two.']);
  });

  it('keeps one empty step when the last is removed', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <InstructionBuilder steps={['Only.']} onChange={onChange} />
    );

    await user.click(screen.getByRole('button', { name: 'Remove step 1' }));

    expect(onChange).toHaveBeenCalledWith(['']);
  });

  it('moves a step down', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <InstructionBuilder steps={['One.', 'Two.']} onChange={onChange} />
    );

    await user.click(screen.getByRole('button', { name: 'Move step 1 down' }));

    expect(onChange).toHaveBeenCalledWith(['Two.', 'One.']);
  });

  it('moves a step up', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(
      <InstructionBuilder steps={['One.', 'Two.']} onChange={onChange} />
    );

    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));

    expect(onChange).toHaveBeenCalledWith(['Two.', 'One.']);
  });

  it('cannot move the first step up or the last step down', () => {
    renderWithProviders(<InstructionBuilder steps={['One.', 'Two.']} onChange={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Move step 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move step 2 down' })).toBeDisabled();
  });
});
