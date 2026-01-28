// src/pages/Settings.jsx
// User settings page with profile management

import React, { useState } from 'react';
import { Card, Form, Button, Row, Col, Alert, Spinner } from 'react-bootstrap';
// eslint-disable-next-line
import { User, Mail, Lock, Bell, Save } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const Settings = () => {
  const { user, userProfile, updateUserProfile, updateUserPassword } = useAuth();
  
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState(userProfile?.preferences?.phoneNumber || '');
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    const result = await updateUserProfile({
      displayName,
      preferences: {
        ...userProfile?.preferences,
        phoneNumber,
      },
    });

    if (result.success) {
      setSuccess('Profile updated successfully!');
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    const result = await updateUserPassword(currentPassword, newPassword);

    if (result.success) {
      setSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div className="settings-page">
      <div className="mb-4">
        <h1 className="h3 mb-0">Settings</h1>
      </div>

      {success && <Alert variant="success" dismissible onClose={() => setSuccess('')}>{success}</Alert>}
      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}

      <Row className="g-4">
        {/* Profile Settings */}
        <Col lg={6}>
          <Card>
            <Card.Header className="bg-transparent">
              <h5 className="mb-0">
                <User size={18} className="me-2" />
                Profile
              </h5>
            </Card.Header>
            <Card.Body>
              <Form onSubmit={handleProfileUpdate}>
                <Form.Group className="mb-3">
                  <Form.Label>Display Name</Form.Label>
                  <Form.Control
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="bg-light"
                  />
                  <Form.Text className="text-muted">
                    Email cannot be changed at this time.
                  </Form.Text>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Phone Number (for SMS alerts)</Form.Label>
                  <Form.Control
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+1 (555) 123-4567"
                  />
                </Form.Group>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={loading}
                  className="d-flex align-items-center gap-2"
                >
                  {loading ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <Save size={18} />
                  )}
                  Save Changes
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>

        {/* Password Settings */}
        <Col lg={6}>
          <Card>
            <Card.Header className="bg-transparent">
              <h5 className="mb-0">
                <Lock size={18} className="me-2" />
                Change Password
              </h5>
            </Card.Header>
            <Card.Body>
              <Form onSubmit={handlePasswordUpdate}>
                <Form.Group className="mb-3">
                  <Form.Label>Current Password</Form.Label>
                  <Form.Control
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>New Password</Form.Label>
                  <Form.Control
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Confirm New Password</Form.Label>
                  <Form.Control
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    required
                  />
                </Form.Group>

                <Button
                  type="submit"
                  variant="outline-primary"
                  disabled={loading}
                  className="d-flex align-items-center gap-2"
                >
                  {loading ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <Lock size={18} />
                  )}
                  Update Password
                </Button>
              </Form>
            </Card.Body>
          </Card>
        </Col>

        {/* Notification Settings - Placeholder */}
        <Col lg={6}>
          <Card>
            <Card.Header className="bg-transparent">
              <h5 className="mb-0">
                <Bell size={18} className="me-2" />
                Notifications
              </h5>
            </Card.Header>
            <Card.Body>
              <Form.Check
                type="switch"
                id="daily-alerts"
                label="Daily expiration alerts (SMS)"
                className="mb-3"
                disabled
              />
              <Form.Check
                type="switch"
                id="meal-reminders"
                label="Meal prep reminders"
                className="mb-3"
                disabled
              />
              <p className="text-muted small mb-0">
                Notification settings will be enabled in Phase 6.
              </p>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Settings;
