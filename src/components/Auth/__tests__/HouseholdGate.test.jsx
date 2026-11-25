import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as household from '../../../backend/household';
import * as sb from '../../../backend/supabase';
import * as sharing from '../../../backend/sharing';
import RealGate, { useKitchen } from '../HouseholdGate';
import KitchenSwitcher from '../../../sharing/KitchenSwitcher';

const HouseholdGate = ({ children, path = '/dashboard' }) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="*" element={<RealGate>{children}</RealGate>} />
    </Routes>
  </MemoryRouter>
);
import HouseholdSettings from '../HouseholdSettings';

beforeEach(() => {
  jest.clearAllMocks();
  sb.ownHousehold.mockResolvedValue('household-1');
  sb.activeKitchen.mockReturnValue(null);
  sharing.myShares.mockResolvedValue([]);
});

const SHARE = {
  household_id: 'hh-2',
  household: 'Smiths',
  kind: 'partner',
  event_id: '',
  can_edit: true,
};

const Probe = () => {
  const { active, own } = useKitchen();
  return (
    <span>
      {active ? `working in ${active.household}` : 'own kitchen'} {own ? 'has own' : 'no own'}
      <KitchenSwitcher />
    </span>
  );
};

it('lets someone with no household in to what is shared with them, event side only', async () => {
  sb.ownHousehold.mockResolvedValue(null);
  sharing.myShares.mockResolvedValue([SHARE]);
  render(
    <HouseholdGate path="/events">
      <Probe />
    </HouseholdGate>
  );
  expect(await screen.findByText(/working in Smiths/)).toBeInTheDocument();
  expect(sb.setActiveKitchen).toHaveBeenCalledWith(SHARE);
});

it('takes up an invite link opened before signing in', async () => {
  window.localStorage.setItem('kitchenhub.pendingShare', 'x'.repeat(30));
  sharing.myShares.mockResolvedValue([{ ...SHARE, household_id: 'hh-2' }]);
  render(
    <HouseholdGate path="/events">
      <Probe />
    </HouseholdGate>
  );
  expect(await screen.findByText(/working in Smiths/)).toBeInTheDocument();
  expect(sharing.joinShare).toHaveBeenCalledWith('x'.repeat(30));
  expect(window.localStorage.getItem('kitchenhub.pendingShare')).toBeNull();
});

it('keeps a shared kitchen to the event side of the app', async () => {
  sb.activeKitchen.mockReturnValue(SHARE);
  sharing.myShares.mockResolvedValue([SHARE]);
  render(
    <HouseholdGate path="/inventory">
      <Probe />
    </HouseholdGate>
  );
  // Redirected to /events, which renders the same children here.
  expect(await screen.findByText(/working in Smiths/)).toBeInTheDocument();
});

it('offers a switch between my household and shared kitchens', async () => {
  sharing.myShares.mockResolvedValue([SHARE]);
  render(
    <HouseholdGate>
      <Probe />
    </HouseholdGate>
  );
  expect(await screen.findByText(/own kitchen has own/)).toBeInTheDocument();
  expect(screen.getByLabelText('Which kitchen')).toHaveDisplayValue('My household');
});

it('forgets a shared kitchen that was taken away', async () => {
  sb.activeKitchen.mockReturnValue(SHARE);
  render(
    <HouseholdGate>
      <Probe />
    </HouseholdGate>
  );
  expect(await screen.findByText(/own kitchen/)).toBeInTheDocument();
  expect(sb.setActiveKitchen).toHaveBeenCalledWith(null);
});

it('lets someone with a household straight in', async () => {
  render(<HouseholdGate>the kitchen</HouseholdGate>);
  expect(await screen.findByText('the kitchen')).toBeInTheDocument();
});

it('asks someone with none to join theirs with its code, or make one', async () => {
  sb.ownHousehold.mockResolvedValueOnce(null).mockResolvedValue('hh');
  const user = userEvent.setup();
  render(<HouseholdGate>the kitchen</HouseholdGate>);
  await user.type(await screen.findByLabelText('Join yours with its code'), 'abcd2345');
  await user.click(screen.getByRole('button', { name: 'Join' }));
  expect(household.joinHousehold).toHaveBeenCalledWith('ABCD2345');
  expect(await screen.findByText('the kitchen')).toBeInTheDocument();
});

it('makes a household, and explains a code that did not work', async () => {
  sb.ownHousehold.mockResolvedValue(null);
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
  sb.ownHousehold.mockRejectedValueOnce(new Error('offline')).mockResolvedValue('hh');
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
