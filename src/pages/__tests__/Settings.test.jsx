// Settings, focused on the Waste Alerts panel added in 6.2. The other panels
// are covered by their own component tests; what matters here is that the SMS
// preferences are reachable and that saving writes the documented shape.

import React from 'react';

import Settings from '../Settings';
import {
  renderWithProviders,
  screen,
  waitFor,
  act,
  userEvent,
  firestoreMock as fs,
  authMock,
} from '../../test-utils';
import { asDocs, makeLocation, makeUserProfile } from '../../test-utils/factories';

const UID = 'test-uid';

const renderSettings = async (userProfile = makeUserProfile()) => {
  const view = renderWithProviders(<Settings />, {
    route: '/settings',
    user: authMock.__user({ uid: UID }),
    userProfile,
  });

  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(`users/${UID}/storageLocations`, asDocs([makeLocation({ id: 'loc-fridge' })]));
  });

  return view;
};

/** The settings sidebar renders its sections as buttons, not links. */
const section = (name) => screen.getByRole('button', { name });

describe('Settings waste alerts panel', () => {
  it('offers a Waste Alerts section', async () => {
    await renderSettings();
    expect(section(/Waste Alerts/)).toBeInTheDocument();
  });

  it('opens the SMS preferences when the section is chosen', async () => {
    await renderSettings();

    expect(screen.queryByTestId('sms-alert-settings')).not.toBeInTheDocument();

    await act(async () => {
      await userEvent.click(section(/Waste Alerts/));
    });

    expect(screen.getByTestId('sms-alert-settings')).toBeInTheDocument();
    expect(
      screen.getByText(/A daily nudge about food that is about to go off/)
    ).toBeInTheDocument();
  });

  it('saves the preferences to the user document', async () => {
    await renderSettings();

    await act(async () => {
      await userEvent.click(section(/Waste Alerts/));
    });
    await act(async () => {
      await userEvent.click(screen.getByLabelText(/Text me when food is about to go off/));
      await userEvent.type(screen.getByLabelText('Mobile number'), '5551234567');
      await userEvent.click(screen.getByRole('button', { name: /Save Alert Preferences/ }));
    });

    await waitFor(() => expect(fs.setDoc).toHaveBeenCalled());
    const [ref, payload] = fs.setDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`users/${UID}`);
    expect(payload.preferences.smsAlerts).toEqual({
      enabled: true,
      phoneNumber: '5551234567',
      time: '09:00',
    });
  });

  it('starts on the profile section, not on alerts', async () => {
    await renderSettings();

    expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument();
    expect(screen.queryByTestId('sms-alert-settings')).not.toBeInTheDocument();
  });
});
