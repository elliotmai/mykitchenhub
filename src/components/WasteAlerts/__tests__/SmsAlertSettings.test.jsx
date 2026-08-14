// SMS preferences. There is no SMS provider key configured, so the important
// behaviours are: the switch saves, the number is validated, and nothing here
// implies texts are already going out.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SmsAlertSettings, { isPlausiblePhoneNumber } from '../SmsAlertSettings';

const preferences = (overrides = {}) => ({
  smsAlerts: { enabled: false, phoneNumber: '', time: '09:00' },
  notifications: { expiringSoon: true },
  ...overrides,
});

describe('isPlausiblePhoneNumber', () => {
  it.each([
    ['+1 (555) 123-4567', true],
    ['5551234567', true],
    ['555-1234', false],
    ['', false],
    [null, false],
    ['1234567890123456', false],
  ])('treats %p as dialable: %p', (value, expected) => {
    expect(isPlausiblePhoneNumber(value)).toBe(expected);
  });
});

describe('SmsAlertSettings', () => {
  it('is honest that alerts arrive in the app either way', () => {
    render(<SmsAlertSettings preferences={preferences()} onSave={jest.fn()} />);

    expect(screen.getByText(/Alerts always show up here in the app/)).toBeInTheDocument();
  });

  it('keeps the number and time fields out of the way until alerts are on', () => {
    render(<SmsAlertSettings preferences={preferences()} onSave={jest.fn()} />);

    expect(screen.getByLabelText('Mobile number')).toBeDisabled();
    expect(screen.getByLabelText('Send my daily alert at')).toBeDisabled();
  });

  it('saves the preferences in the documented shape', async () => {
    const onSave = jest.fn().mockResolvedValue({ success: true });
    render(<SmsAlertSettings preferences={preferences()} onSave={onSave} />);

    await userEvent.click(screen.getByLabelText(/Text me when food is about to go off/));
    await userEvent.type(screen.getByLabelText('Mobile number'), '5551234567');
    await userEvent.click(screen.getByRole('button', { name: /Save Alert Preferences/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].preferences.smsAlerts).toEqual({
      enabled: true,
      phoneNumber: '5551234567',
      time: '09:00',
    });
    // Everything else in the profile survives the save.
    expect(onSave.mock.calls[0][0].preferences.notifications).toEqual({ expiringSoon: true });
  });

  it('refuses to turn texts on without a number to text', async () => {
    const onSave = jest.fn();
    render(<SmsAlertSettings preferences={preferences()} onSave={onSave} />);

    await userEvent.click(screen.getByLabelText(/Text me when food is about to go off/));
    await userEvent.click(screen.getByRole('button', { name: /Save Alert Preferences/ }));

    expect(await screen.findByText(/Enter a mobile number we can text/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lets alerts be switched off without needing a valid number', async () => {
    const onSave = jest.fn().mockResolvedValue({ success: true });
    render(
      <SmsAlertSettings
        preferences={preferences({
          smsAlerts: { enabled: true, phoneNumber: '555', time: '09:00' },
        })}
        onSave={onSave}
      />
    );

    await userEvent.click(screen.getByLabelText(/Text me when food is about to go off/));
    await userEvent.click(screen.getByRole('button', { name: /Save Alert Preferences/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].preferences.smsAlerts.enabled).toBe(false);
  });

  it('adopts the profile once it arrives from Firestore', () => {
    const { rerender } = render(<SmsAlertSettings preferences={undefined} onSave={jest.fn()} />);
    expect(screen.getByLabelText('Mobile number')).toHaveValue('');

    rerender(
      <SmsAlertSettings
        preferences={preferences({
          smsAlerts: { enabled: true, phoneNumber: '5559876543', time: '07:30' },
        })}
        onSave={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Mobile number')).toHaveValue('5559876543');
    expect(screen.getByLabelText('Send my daily alert at')).toHaveValue('07:30');
  });

  it('falls back to the number already on the profile', () => {
    render(
      <SmsAlertSettings
        preferences={{ phoneNumber: '5551112222', smsAlerts: {} }}
        onSave={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Mobile number')).toHaveValue('5551112222');
  });

  it('reports a save failure', async () => {
    const onSave = jest.fn().mockResolvedValue({ success: false, error: 'Could not save.' });
    render(<SmsAlertSettings preferences={preferences()} onSave={onSave} />);

    await userEvent.click(screen.getByRole('button', { name: /Save Alert Preferences/ }));

    expect(await screen.findByText('Could not save.')).toBeInTheDocument();
  });

  it('confirms a successful save', async () => {
    const onSave = jest.fn().mockResolvedValue({ success: true });
    render(<SmsAlertSettings preferences={preferences()} onSave={onSave} />);

    await userEvent.click(screen.getByRole('button', { name: /Save Alert Preferences/ }));

    expect(await screen.findByText('Alert preferences saved.')).toBeInTheDocument();
  });
});
