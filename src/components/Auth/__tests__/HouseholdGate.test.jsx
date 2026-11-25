import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as household from '../../../backend/household';
import HouseholdGate from '../HouseholdGate';
import HouseholdSettings from '../HouseholdSettings';

beforeEach(() => jest.clearAllMocks());

it('lets someone with a household straight in', async () => {
  render(<HouseholdGate>the kitchen</HouseholdGate>);
  expect(await screen.findByText('the kitchen')).toBeInTheDocument();
});

it('asks someone with none to join theirs with its code, or make one', async () => {
  household.currentHousehold.mockResolvedValueOnce(null).mockResolvedValue('hh');
  const user = userEvent.setup();
  render(<HouseholdGate>the kitchen</HouseholdGate>);
  await user.type(await screen.findByLabelText('Join yours with its code'), 'abcd2345');
  await user.click(screen.getByRole('button', { name: 'Join' }));
  expect(household.joinHousehold).toHaveBeenCalledWith('ABCD2345');
  expect(await screen.findByText('the kitchen')).toBeInTheDocument();
});

it('makes a household, and explains a code that did not work', async () => {
  household.currentHousehold.mockResolvedValue(null);
  household.joinHousehold.mockRejectedValueOnce(new Error('invalid invite'));
  const user = userEvent.setup();
  render(<HouseholdGate>the kitchen</HouseholdGate>);
  await user.type(await screen.findByLabelText('Join yours with its code'), 'nope');
  await user.click(screen.getByRole('button', { name: 'Join' }));
  expect(await screen.findByText(/That code didn’t work/)).toBeInTheDocument();
  await user.type(screen.getByLabelText('Or make a new household'), 'The Smiths');
  await user.click(screen.getByRole('button', { name: 'Make a household' }));
  expect(household.createHousehold).toHaveBeenCalledWith('The Smiths');
});

it('offers to try again when the check fails', async () => {
  household.currentHousehold.mockRejectedValueOnce(new Error('offline')).mockResolvedValue('hh');
  const user = userEvent.setup();
  render(<HouseholdGate>the kitchen</HouseholdGate>);
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('the kitchen')).toBeInTheDocument();
});

it('shows the household code, and makes a new one', async () => {
  const user = userEvent.setup();
  render(<HouseholdSettings />);
  await user.click(screen.getByRole('button', { name: 'Show the household code' }));
  expect(await screen.findByText('ABCD2345')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'New code' }));
  expect(await screen.findByText('WXYZ6789')).toBeInTheDocument();
});

it('tells a member who is not the owner why there is no code', async () => {
  household.householdCode.mockRejectedValueOnce(new Error('only the owner can invite'));
  const user = userEvent.setup();
  render(<HouseholdSettings />);
  await user.click(screen.getByRole('button', { name: 'Show the household code' }));
  await waitFor(() => expect(screen.getByText(/Only the household’s owner/)).toBeInTheDocument());
});
