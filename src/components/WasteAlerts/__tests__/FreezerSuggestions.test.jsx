// "Freeze it instead" is the single most useful thing this page does, so the
// tests are written around what a cook sees and taps.

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FreezerSuggestions from '../FreezerSuggestions';
import { makeItem, makeLocation, daysFromNow } from '../../../test-utils/factories';

const FREEZER = makeLocation({ id: 'loc-freezer', label: 'Freezer', type: 'freezer' });

const suggestion = (overrides = {}) => ({
  item: makeItem({
    id: 'item-1',
    name: 'Chicken Breast',
    quantity: 4,
    unit: 'lbs',
    expiresAt: daysFromNow(1),
    ...overrides.item,
  }),
  frozenDays: 270,
  daysLeft: 1,
  daysGained: 269,
  ...overrides,
});

describe('FreezerSuggestions content', () => {
  it('says how much longer the item would keep', () => {
    render(<FreezerSuggestions suggestions={[suggestion()]} freezerLocation={FREEZER} />);

    expect(screen.getByText('Chicken Breast')).toBeInTheDocument();
    expect(screen.getByText('+269 days if you freeze it')).toBeInTheDocument();
    expect(screen.getByText(/Keeps about 270 days frozen/)).toBeInTheDocument();
  });

  it('says so plainly when nothing is worth freezing', () => {
    render(<FreezerSuggestions suggestions={[]} freezerLocation={FREEZER} />);

    expect(screen.getByText(/Nothing here would keep much longer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Freeze All' })).not.toBeInTheDocument();
  });

  it('points at Settings when there is no freezer to move things into', () => {
    render(<FreezerSuggestions suggestions={[suggestion()]} freezerLocation={null} />);

    expect(screen.getByText(/Add a freezer in Settings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Freeze All' })).toBeDisabled();
  });
});

describe('FreezerSuggestions actions', () => {
  it('freezes the whole item', async () => {
    const onFreezeAll = jest.fn().mockResolvedValue({ success: true });
    const match = suggestion();
    render(
      <FreezerSuggestions
        suggestions={[match]}
        freezerLocation={FREEZER}
        onFreezeAll={onFreezeAll}
      />
    );

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Freeze All' }));
    });

    expect(onFreezeAll).toHaveBeenCalledWith(match.item);
  });

  it('freezes half', async () => {
    const onFreezeHalf = jest.fn().mockResolvedValue({ success: true });
    const match = suggestion();
    render(
      <FreezerSuggestions
        suggestions={[match]}
        freezerLocation={FREEZER}
        onFreezeHalf={onFreezeHalf}
      />
    );

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Freeze Half' }));
    });

    expect(onFreezeHalf).toHaveBeenCalledWith(match.item);
  });

  it('will not offer to halve a single item', () => {
    render(
      <FreezerSuggestions
        suggestions={[suggestion({ item: { quantity: 1 } })]}
        freezerLocation={FREEZER}
      />
    );

    expect(screen.getByRole('button', { name: 'Freeze Half' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Freeze All' })).toBeEnabled();
  });

  it('shows the reason when a freeze does not go through', async () => {
    const onFreezeAll = jest.fn().mockResolvedValue({ success: false, error: 'You are offline.' });
    render(
      <FreezerSuggestions
        suggestions={[suggestion()]}
        freezerLocation={FREEZER}
        onFreezeAll={onFreezeAll}
      />
    );

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Freeze All' }));
    });

    await waitFor(() => expect(screen.getByText('You are offline.')).toBeInTheDocument());
  });

  it('does not crash when no handlers are wired up', async () => {
    render(<FreezerSuggestions suggestions={[suggestion()]} freezerLocation={FREEZER} />);

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Freeze All' }));
    });

    expect(screen.getByText('Chicken Breast')).toBeInTheDocument();
  });
});
