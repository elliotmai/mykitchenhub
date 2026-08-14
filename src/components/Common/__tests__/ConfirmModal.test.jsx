// ConfirmModal guards every destructive action in the app. The behaviour that
// matters is that it can't be confirmed twice, and can't be confirmed at all
// while an action is in flight.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ConfirmModal, {
  DeleteConfirmModal,
  UnsavedChangesModal,
  ActionConfirmModal,
} from '../ConfirmModal';

const setup = (props = {}) => {
  const onConfirm = jest.fn();
  const onHide = jest.fn();
  render(<ConfirmModal show onConfirm={onConfirm} onHide={onHide} {...props} />);
  return { onConfirm, onHide };
};

describe('ConfirmModal', () => {
  it('renders nothing until asked to show', () => {
    render(<ConfirmModal show={false} title="Delete Item" />);
    expect(screen.queryByText('Delete Item')).not.toBeInTheDocument();
  });

  it('shows the title and message it is given', () => {
    setup({ title: 'Delete Milk', message: 'This cannot be undone.' });

    expect(screen.getByText('Delete Milk')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('accepts a rich message node, not just a string', () => {
    setup({
      message: (
        <span data-testid="rich">
          Delete <strong>Milk</strong>?
        </span>
      ),
    });
    expect(screen.getByTestId('rich')).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is pressed', async () => {
    const { onConfirm } = setup({ confirmText: 'Delete' });

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onHide when cancelled', async () => {
    const { onHide, onConfirm } = setup({ cancelText: 'Keep it' });

    await userEvent.click(screen.getByRole('button', { name: /keep it/i }));

    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables both buttons while the action is in flight', () => {
    setup({ loading: true, confirmText: 'Delete', cancelText: 'Cancel' });

    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('ignores a confirm attempt while loading', async () => {
    const { onConfirm } = setup({ loading: true, confirmText: 'Delete' });

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders extra children alongside the message', () => {
    render(
      <ConfirmModal show onConfirm={jest.fn()} onHide={jest.fn()}>
        <label htmlFor="ack">I understand</label>
      </ConfirmModal>
    );

    expect(screen.getByText('I understand')).toBeInTheDocument();
  });

  it.each(['danger', 'warning', 'info', 'success', 'question'])(
    'renders the %s variant without falling over',
    (variant) => {
      render(
        <ConfirmModal
          show
          variant={variant}
          title={`v-${variant}`}
          onConfirm={jest.fn()}
          onHide={jest.fn()}
        />
      );
      expect(screen.getByText(`v-${variant}`)).toBeInTheDocument();
    }
  );
});

describe('preset confirm modals', () => {
  it('DeleteConfirmModal names the item being deleted', () => {
    render(
      <DeleteConfirmModal show itemName="Whole Milk" onConfirm={jest.fn()} onHide={jest.fn()} />
    );

    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('Whole Milk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('UnsavedChangesModal offers Stay and Leave', () => {
    render(<UnsavedChangesModal show onConfirm={jest.fn()} onHide={jest.fn()} />);

    expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stay/i })).toBeInTheDocument();
  });

  it('ActionConfirmModal describes the action in the message', () => {
    render(
      <ActionConfirmModal show action="sync 500 recipes" onConfirm={jest.fn()} onHide={jest.fn()} />
    );

    expect(screen.getByText(/sync 500 recipes/)).toBeInTheDocument();
  });
});
