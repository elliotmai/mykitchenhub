// src/components/WasteAlerts/SmsAlertSettings.jsx
// SMS preferences for the daily waste alert — roadmap 6.2.
//
// Stored at users/{uid}.preferences.smsAlerts = { enabled, phoneNumber, time },
// the shape onUserCreate seeds and the scheduled function reads.
//
// There is no SMS provider key configured yet, so the copy is honest about it:
// alerts always arrive in the app, and texts start flowing once the owner adds
// a provider key.

import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { MessageSquare } from 'lucide-react';

/** Anything that looks like a dialable number, once punctuation is stripped. */
export const isPlausiblePhoneNumber = (value) => {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 15;
};

export const DEFAULT_ALERT_TIME = '09:00';

/**
 * SmsAlertSettings
 *
 * @param {object}   preferences - the user document's `preferences` map
 * @param {function} onSave      - async (preferencesPatch) => { success, error }
 */
const SmsAlertSettings = ({ preferences, onSave }) => {
  const smsAlerts = preferences?.smsAlerts ?? {};

  const [enabled, setEnabled] = useState(Boolean(smsAlerts.enabled));
  const [phoneNumber, setPhoneNumber] = useState(
    smsAlerts.phoneNumber ?? preferences?.phoneNumber ?? ''
  );
  const [time, setTime] = useState(smsAlerts.time || DEFAULT_ALERT_TIME);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // The profile arrives asynchronously, so adopt it when it lands.
  useEffect(() => {
    setEnabled(Boolean(smsAlerts.enabled));
    setPhoneNumber(smsAlerts.phoneNumber ?? preferences?.phoneNumber ?? '');
    setTime(smsAlerts.time || DEFAULT_ALERT_TIME);
  }, [smsAlerts.enabled, smsAlerts.phoneNumber, smsAlerts.time, preferences?.phoneNumber]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (enabled && !isPlausiblePhoneNumber(phoneNumber)) {
      setError('Enter a mobile number we can text, including the area code.');
      return;
    }

    setSaving(true);
    const result = await onSave({
      preferences: {
        ...preferences,
        smsAlerts: { enabled, phoneNumber: phoneNumber.trim(), time },
      },
    });
    setSaving(false);

    if (result?.success) setSuccess('Alert preferences saved.');
    else setError(result?.error || 'Could not save your preferences. Please try again.');
  };

  return (
    <Form onSubmit={handleSubmit} data-testid="sms-alert-settings">
      {success && (
        <Alert variant="success" className="py-2">
          {success}
        </Alert>
      )}
      {error && (
        <Alert variant="danger" className="py-2">
          {error}
        </Alert>
      )}

      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          id="sms-alerts-enabled"
          label="Text me when food is about to go off"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <Form.Text className="text-muted">
          Alerts always show up here in the app. Turn this on and they will also arrive as a text
          once a texting service is connected.
        </Form.Text>
      </Form.Group>

      <Form.Group className="mb-3" controlId="sms-alerts-phone">
        <Form.Label>Mobile number</Form.Label>
        <Form.Control
          type="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+1 (555) 000-0000"
          disabled={!enabled}
        />
      </Form.Group>

      <Form.Group className="mb-4" controlId="sms-alerts-time">
        <Form.Label>Send my daily alert at</Form.Label>
        <Form.Control
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          disabled={!enabled}
        />
        <Form.Text className="text-muted">
          Alerts currently go out each morning at 9:00 AM Eastern.
        </Form.Text>
      </Form.Group>

      <Button
        type="submit"
        variant="primary"
        disabled={saving}
        className="d-flex align-items-center gap-2"
      >
        {saving ? <Spinner size="sm" /> : <MessageSquare size={16} />}
        {saving ? 'Saving…' : 'Save Alert Preferences'}
      </Button>
    </Form>
  );
};

export default SmsAlertSettings;
